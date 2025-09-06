import { Database } from 'bun:sqlite';
import { HierarchicalNSW } from 'hnswlib-node';
import type { CortexConfig } from './config.js';

export interface NoteRecord {
  id: string;
  title: string;
  content: string;
  path: string;
  frontmatter_json: string;
  created_at: string;
  updated_at: string;
  tags_json: string;
  embedding_id?: number;
}

export interface EmbeddingRecord {
  id: number;
  note_id: string;
  embedding: Float32Array;
  created_at: string;
}

export interface MigrationRecord {
  id: number;
  name: string;
  applied_at: string;
}

export class DatabaseManager {
  private db: Database | null = null;
  private vectorIndex: HierarchicalNSW | null = null;
  private readonly dbPath: string;
  private readonly vectorIndexPath: string;
  
  constructor(private config: CortexConfig) {
    this.dbPath = config.databasePath;
    this.vectorIndexPath = config.databasePath.replace('.db', '_vector_index.bin');
  }

  async initialize(): Promise<void> {
    await this.ensureDataDirectory();
    await this.initializeDatabase();
    await this.runMigrations();
    await this.initializeVectorIndex();
  }

  private async ensureDataDirectory(): Promise<void> {
    const { ensureDir } = await import('./utils.js');
    const { dirname } = await import('path');
    await ensureDir(dirname(this.dbPath));
  }

  private async initializeDatabase(): Promise<void> {
    this.db = new Database(this.dbPath);
    
    // Enable WAL mode for better concurrent access
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA synchronous = NORMAL');
    this.db.run('PRAGMA cache_size = 1000');
    this.db.run('PRAGMA temp_store = memory');
    this.db.run('PRAGMA foreign_keys = ON');
  }

  private async runMigrations(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    // Create migrations table if it doesn't exist
    this.db.run(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const migrations = [
      {
        name: '001_initial_schema',
        sql: `
          CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            path TEXT UNIQUE NOT NULL,
            frontmatter_json TEXT DEFAULT '{}',
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            tags_json TEXT DEFAULT '[]',
            embedding_id INTEGER
          );
          
          CREATE TABLE IF NOT EXISTS embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_id TEXT NOT NULL,
            embedding BLOB NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
          );
          
          CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes (created_at);
          CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes (updated_at);
          CREATE INDEX IF NOT EXISTS idx_notes_title ON notes (title);
          CREATE INDEX IF NOT EXISTS idx_embeddings_note_id ON embeddings (note_id);
        `
      },
      {
        name: '002_fulltext_search',
        sql: `
          CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            title,
            content,
            tags,
            content='notes',
            content_rowid='rowid'
          );
          
          CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON notes BEGIN
            INSERT INTO notes_fts(rowid, title, content, tags) 
            VALUES (new.rowid, new.title, new.content, new.tags_json);
          END;
          
          CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content, tags) 
            VALUES ('delete', old.rowid, old.title, old.content, old.tags_json);
            INSERT INTO notes_fts(rowid, title, content, tags) 
            VALUES (new.rowid, new.title, new.content, new.tags_json);
          END;
          
          CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON notes BEGIN
            INSERT INTO notes_fts(notes_fts, rowid, title, content, tags) 
            VALUES ('delete', old.rowid, old.title, old.content, old.tags_json);
          END;
        `
      }
    ];

    const appliedMigrations = this.db.prepare('SELECT name FROM migrations').all() as { name: string }[];
    const appliedNames = new Set(appliedMigrations.map(m => m.name));

    for (const migration of migrations) {
      if (!appliedNames.has(migration.name)) {
        console.log(`Applying migration: ${migration.name}`);
        
        this.db.run('BEGIN TRANSACTION');
        try {
          this.db.run(migration.sql);
          this.db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
          this.db.run('COMMIT');
          console.log(`Migration ${migration.name} applied successfully`);
        } catch (error) {
          this.db.run('ROLLBACK');
          throw new Error(`Migration ${migration.name} failed: ${error}`);
        }
      }
    }
  }

  private async initializeVectorIndex(): Promise<void> {
    const dimension = 1536; // OpenAI embeddings dimension
    const maxElements = 100000; // Maximum number of vectors
    
    try {
      // Try to load existing index
      const indexExists = await Bun.file(this.vectorIndexPath).exists();
      
      if (indexExists) {
        this.vectorIndex = new HierarchicalNSW('cosine', dimension);
        this.vectorIndex.readIndexSync(this.vectorIndexPath);
        console.log('Vector index loaded from disk');
      } else {
        // Create new index
        this.vectorIndex = new HierarchicalNSW('cosine', dimension);
        this.vectorIndex.initIndex(maxElements);
        console.log('New vector index created');
      }
    } catch (error) {
      console.error('Error initializing vector index:', error);
      // Create new index as fallback
      this.vectorIndex = new HierarchicalNSW('cosine', dimension);
      this.vectorIndex.initIndex(maxElements);
    }
  }

  // CRUD Operations for Notes
  async createNote(note: Omit<NoteRecord, 'embedding_id'>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT INTO notes (id, title, content, path, frontmatter_json, created_at, updated_at, tags_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      note.id,
      note.title,
      note.content,
      note.path,
      note.frontmatter_json,
      note.created_at,
      note.updated_at,
      note.tags_json
    );
  }

  async getNoteById(id: string): Promise<NoteRecord | null> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM notes WHERE id = ?');
    const result = stmt.get(id) as NoteRecord | undefined;
    return result || null;
  }

  async getNoteByPath(path: string): Promise<NoteRecord | null> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM notes WHERE path = ?');
    const result = stmt.get(path) as NoteRecord | undefined;
    return result || null;
  }

  async updateNote(id: string, updates: Partial<Omit<NoteRecord, 'id' | 'created_at'>>): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(id);

    const stmt = this.db.prepare(`UPDATE notes SET ${fields} WHERE id = ?`);
    stmt.run(...values);
  }

  async deleteNote(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('DELETE FROM notes WHERE id = ?');
    stmt.run(id);
  }

  async getAllNotes(limit?: number, offset?: number): Promise<NoteRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    let sql = 'SELECT * FROM notes ORDER BY created_at DESC';
    const params: any[] = [];
    
    if (limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(limit);
      
      if (offset !== undefined) {
        sql += ' OFFSET ?';
        params.push(offset);
      }
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as NoteRecord[];
  }

  // Full-text search
  async searchNotes(query: string, limit: number = 50): Promise<NoteRecord[]> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT notes.* FROM notes_fts
      JOIN notes ON notes.rowid = notes_fts.rowid
      WHERE notes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    
    return stmt.all(query, limit) as NoteRecord[];
  }

  // Vector operations
  async storeEmbedding(noteId: string, embedding: number[]): Promise<number> {
    if (!this.db || !this.vectorIndex) throw new Error('Database or vector index not initialized');

    // Store in database
    const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);
    const stmt = this.db.prepare(`
      INSERT INTO embeddings (note_id, embedding)
      VALUES (?, ?)
      RETURNING id
    `);
    
    const result = stmt.get(noteId, embeddingBlob) as { id: number };
    const embeddingId = result.id;

    // Add to vector index
    this.vectorIndex.addPoint(embedding, embeddingId);

    // Update note record with embedding_id
    await this.updateNote(noteId, { embedding_id: embeddingId });

    // Save vector index to disk
    await this.saveVectorIndex();

    return embeddingId;
  }

  async getEmbedding(embeddingId: number): Promise<number[] | null> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT embedding FROM embeddings WHERE id = ?');
    const result = stmt.get(embeddingId) as { embedding: Buffer } | undefined;
    
    if (!result) return null;

    const float32Array = new Float32Array(result.embedding.buffer);
    return Array.from(float32Array);
  }

  async searchSimilarNotes(queryEmbedding: number[], k: number = 10): Promise<{ noteId: string; similarity: number }[]> {
    if (!this.db || !this.vectorIndex) throw new Error('Database or vector index not initialized');

    const results = this.vectorIndex.searchKnn(queryEmbedding, k);
    
    // Get note IDs from embedding IDs
    const noteResults: { noteId: string; similarity: number }[] = [];
    
    for (let i = 0; i < results.distances.length; i++) {
      const embeddingId = results.neighbors[i];
      const similarity = 1 - (results.distances[i] ?? 0); // Convert distance to similarity
      
      if (embeddingId === undefined) continue;
      
      const stmt = this.db.prepare('SELECT note_id FROM embeddings WHERE id = ?');
      const result = stmt.get(embeddingId) as { note_id: string } | undefined;
      
      if (result) {
        noteResults.push({
          noteId: result.note_id,
          similarity
        });
      }
    }
    
    return noteResults.sort((a, b) => b.similarity - a.similarity);
  }

  async saveVectorIndex(): Promise<void> {
    if (!this.vectorIndex) throw new Error('Vector index not initialized');
    
    this.vectorIndex.writeIndexSync(this.vectorIndexPath);
  }

  async close(): Promise<void> {
    if (this.vectorIndex) {
      await this.saveVectorIndex();
      this.vectorIndex = null;
    }
    
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Database statistics
  async getStats(): Promise<{
    totalNotes: number;
    totalEmbeddings: number;
    dbSizeBytes: number;
    indexSizeBytes: number;
  }> {
    if (!this.db) throw new Error('Database not initialized');

    const notesCount = this.db.prepare('SELECT COUNT(*) as count FROM notes').get() as { count: number };
    const embeddingsCount = this.db.prepare('SELECT COUNT(*) as count FROM embeddings').get() as { count: number };
    
    const dbFile = Bun.file(this.dbPath);
    const indexFile = Bun.file(this.vectorIndexPath);
    
    const dbSize = await dbFile.exists() ? (await dbFile.stat()).size : 0;
    const indexSize = await indexFile.exists() ? (await indexFile.stat()).size : 0;

    return {
      totalNotes: notesCount.count,
      totalEmbeddings: embeddingsCount.count,
      dbSizeBytes: dbSize,
      indexSizeBytes: indexSize
    };
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.db || !this.vectorIndex) return false;
      
      // Test database connection
      this.db.prepare('SELECT 1').get();
      
      // Test vector index
      const testVector = Array(1536).fill(0.1);
      this.vectorIndex.searchKnn(testVector, 1);
      
      return true;
    } catch {
      return false;
    }
  }
}