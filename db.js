/* ==================================================
   Wrapper de SQLite (vía sql.js) para la PWA
   Replica la estructura de la base de datos de la app de PC.
   ================================================== */

const DB = {
  SQL: null,
  db: null,
  isDirty: false,  // Hay cambios pendientes de subir

  async init() {
    // Cargar sql.js
    if (!this.SQL) {
      this.SQL = await initSqlJs({
        locateFile: f => f
      });
    }
  },

  /** Carga la BD desde un Uint8Array (descargado de Dropbox). */
  loadFromBytes(bytes) {
    this.db = new this.SQL.Database(bytes);
    this._ensureSchema();
    this.isDirty = false;
  },

  /** Crea una BD vacía desde cero (cuando no existe en Dropbox aún). */
  createEmpty() {
    this.db = new this.SQL.Database();
    this._ensureSchema();
    this.isDirty = true;
  },

  _ensureSchema() {
    // Aplica el mismo esquema que la app de PC.
    this.db.run(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6b7280'
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        due_date TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'media',
        category_id INTEGER,
        reminder_time TEXT,
        notes TEXT,
        completed INTEGER NOT NULL DEFAULT 0,
        rolled_over INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS subtasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        position INTEGER DEFAULT 0,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS notification_log (
        task_id INTEGER PRIMARY KEY,
        shown_date TEXT NOT NULL
      );
    `);
  },

  /** Exporta la BD como Uint8Array (para subir a Dropbox). */
  export() {
    return this.db.export();
  },

  /** Helper: ejecuta un SELECT y devuelve filas como objetos. */
  query(sql, params = []) {
    if (!this.db) return [];
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  },

  /** Helper: ejecuta un INSERT/UPDATE/DELETE. */
  exec(sql, params = []) {
    if (!this.db) return;
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
    this.isDirty = true;
  },

  /* ------------ Categorías ------------ */
  getCategories() {
    return this.query('SELECT * FROM categories ORDER BY name');
  },

  addCategory(name, color) {
    this.exec('INSERT INTO categories(name, color) VALUES (?, ?)', [name, color]);
  },

  updateCategory(id, name, color) {
    this.exec('UPDATE categories SET name=?, color=? WHERE id=?', [name, color, id]);
  },

  deleteCategory(id) {
    this.exec('DELETE FROM categories WHERE id=?', [id]);
  },

  /* ------------ Tareas ------------ */
  getTasksByDate(dateStr, includeCompleted = true) {
    let sql = `SELECT t.*, c.name AS category_name, c.color AS category_color
               FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
               WHERE t.due_date = ?`;
    if (!includeCompleted) sql += ' AND t.completed = 0';
    sql += ` ORDER BY t.completed ASC,
             CASE priority WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2
                           WHEN 'media' THEN 3 WHEN 'baja' THEN 4 END,
             t.reminder_time ASC, t.id ASC`;
    return this.query(sql, [dateStr]);
  },

  addTask(task) {
    this.exec(
      `INSERT INTO tasks(title, due_date, priority, category_id, reminder_time, notes, completed, rolled_over)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
      [task.title, task.due_date, task.priority,
       task.category_id || null, task.reminder_time || null, task.notes || null]
    );
  },

  updateTask(id, fields) {
    const cols = [], vals = [];
    for (const k of ['title', 'due_date', 'priority', 'category_id', 'reminder_time', 'notes']) {
      if (k in fields) { cols.push(`${k}=?`); vals.push(fields[k]); }
    }
    if (!cols.length) return;
    vals.push(id);
    this.exec(`UPDATE tasks SET ${cols.join(',')} WHERE id=?`, vals);
  },

  deleteTask(id) {
    this.exec('DELETE FROM tasks WHERE id=?', [id]);
  },

  setTaskCompleted(id, completed) {
    this.exec('UPDATE tasks SET completed=? WHERE id=?', [completed ? 1 : 0, id]);
    if (completed) {
      this.exec('UPDATE subtasks SET completed=1 WHERE task_id=?', [id]);
    }
  },

  /* ------------ Subtareas ------------ */
  getSubtasks(taskId) {
    return this.query('SELECT * FROM subtasks WHERE task_id=? ORDER BY position, id', [taskId]);
  },

  addSubtask(taskId, title) {
    this.exec('INSERT INTO subtasks(task_id, title) VALUES (?, ?)', [taskId, title]);
  },

  setSubtaskCompleted(id, completed) {
    this.exec('UPDATE subtasks SET completed=? WHERE id=?', [completed ? 1 : 0, id]);
  },

  deleteSubtask(id) {
    this.exec('DELETE FROM subtasks WHERE id=?', [id]);
  },

  allSubtasksCompleted(taskId) {
    const r = this.query(
      'SELECT COUNT(*) AS total, SUM(completed) AS done FROM subtasks WHERE task_id=?',
      [taskId]
    );
    if (!r.length || !r[0].total) return false;
    return r[0].done === r[0].total;
  },

  /* ------------ Indicadores del calendario ------------ */
  getTaskCountsByMonth(year, month) {
    const monthStr = String(month).padStart(2, '0');
    const yearStr = String(year);
    const lastDay = new Date(year, month, 0).getDate();
    const first = `${yearStr}-${monthStr}-01`;
    const last = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
    const rows = this.query(
      'SELECT due_date, completed, priority FROM tasks WHERE due_date BETWEEN ? AND ?',
      [first, last]
    );
    const result = {};
    for (const r of rows) {
      const d = r.due_date;
      if (!result[d]) result[d] = { pending: 0, total: 0, priorities: new Set() };
      result[d].total++;
      if (!r.completed) {
        result[d].pending++;
        result[d].priorities.add(r.priority);
      }
    }
    return result;
  },

  /* ------------ Rollover ------------ */
  rolloverUnfinished() {
    const today = new Date().toISOString().slice(0, 10);
    const rows = this.query(
      'SELECT COUNT(*) AS c FROM tasks WHERE completed=0 AND due_date < ?',
      [today]
    );
    const moved = rows[0]?.c || 0;
    if (moved > 0) {
      this.exec(
        'UPDATE tasks SET due_date=?, rolled_over=1 WHERE completed=0 AND due_date < ?',
        [today, today]
      );
    }
    return moved;
  }
};
