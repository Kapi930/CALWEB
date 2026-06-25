/* ==================================================
   APP.JS - Lógica principal de la PWA
   ================================================== */

const PRIORITY_COLORS = {
  urgente: '#dc2626', alta: '#f59e0b', media: '#3b82f6', baja: '#10b981'
};
const PRIORITY_NAMES = {
  urgente: 'Urgente', alta: 'Alta', media: 'Media', baja: 'Baja'
};
const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const App = {
  state: {
    selectedDate: new Date(),
    activeTab: 'pending',  // 'pending' o 'done'
    groupMode: 'category', // 'category' o 'priority'
    theme: 'light',
    editingTaskId: null,
    detailTaskId: null,
    calendarViewDate: new Date(),
    syncTimer: null,
    syncing: false
  },

  async init() {
    await DB.init();

    // Restaurar tema desde localStorage
    this.state.theme = localStorage.getItem('theme') || 'light';
    this.state.groupMode = localStorage.getItem('groupMode') || 'category';
    document.documentElement.setAttribute('data-theme', this.state.theme);
    this._updateThemeBtn();

    // Si Dropbox está configurado, cargar BD; si no, mostrar setup
    if (DBX.isConfigured()) {
      await this._showApp();
    } else {
      this._showSetup();
    }

    this._bindUI();
  },

  /* ---------------- SETUP ---------------- */
  _showSetup() {
    document.getElementById('setup-screen').classList.add('active');
    document.getElementById('main-screen').classList.remove('active');

    document.getElementById('start-auth-btn').onclick = async () => {
      const appKey = document.getElementById('app-key').value.trim();
      if (!appKey) {
        this._showSetupError('Pega primero tu App Key.');
        return;
      }
      try {
        const url = await DBX.startAuth(appKey);
        // En móvil los popups se bloquean — mostrar enlace para abrir manualmente
        document.getElementById('auth-step').classList.remove('hidden');
        document.getElementById('start-auth-btn').textContent = 'Reabrir página de Dropbox';
        // Intentar abrir en nueva pestaña, si falla mostrar el enlace
        const newTab = window.open(url, '_blank');
        if (!newTab) {
          // Popup bloqueado — mostrar enlace clicable
          const authStep = document.getElementById('auth-step');
          const existingLink = authStep.querySelector('.dbx-link');
          if (!existingLink) {
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.className = 'dbx-link';
            link.style.cssText = 'display:block;margin:10px 0;padding:10px;background:#0061fe;color:white;text-align:center;border-radius:8px;text-decoration:none;font-weight:bold;';
            link.textContent = '👆 Pulsa aquí para abrir Dropbox';
            authStep.insertBefore(link, authStep.firstChild);
          }
        }
      } catch (e) {
        this._showSetupError(`Error: ${e.message}`);
      }
    };

    document.getElementById('finish-auth-btn').onclick = async () => {
      const code = document.getElementById('auth-code').value.trim();
      if (!code) {
        this._showSetupError('Pega el código de Dropbox.');
        return;
      }
      try {
        await DBX.finishAuth(code);
        await this._showApp();
      } catch (e) {
        this._showSetupError(`Error: ${e.message}`);
      }
    };
  },

  _showSetupError(msg) {
    const el = document.getElementById('setup-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  },

  /* ---------------- APP ---------------- */
  async _showApp() {
    document.getElementById('setup-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');

    this._setSyncStatus('🔄');
    let downloadedFromDropbox = false;
    try {
      // Debug: mostrar estado del token
      const hasAccess = Boolean(DBX.state.accessToken);
      const hasRefresh = Boolean(DBX.state.refreshToken);
      const hasKey = Boolean(DBX.state.appKey);
      this._toast(`Token: access=${hasAccess} refresh=${hasRefresh} key=${hasKey}`);
      await new Promise(r => setTimeout(r, 3000)); // Esperar 3s para leer el toast

      // Verificar token primero
      if (!hasAccess && !hasRefresh) {
        throw new Error('Sin token. Reconecta Dropbox.');
      }
      // Refrescar token si no hay access token
      if (!hasAccess && hasRefresh) {
        await DBX.refreshAccessToken();
      }
      // Intentar descargar la BD
      const result = await DBX.download();
      if (result) {
        DB.loadFromBytes(result.buffer);
        downloadedFromDropbox = true;
        const count = DB.query('SELECT COUNT(*) AS c FROM tasks')[0]?.c || 0;
        this._toast(`📥 Descargado: ${result.buffer.length} bytes, ${count} tareas`);
      } else {
        DB.createEmpty();
      }
    } catch (e) {
      console.error(e);
      this._toast('Error: ' + (e.message || JSON.stringify(e)));
      DB.createEmpty();
      DB.isDirty = false;
    }

    // Rollover automático (solo si descargamos correctamente de Dropbox)
    if (downloadedFromDropbox) {
      const moved = DB.rolloverUnfinished();
      if (moved > 0) {
        this._toast(`🔄 ${moved} tarea(s) trasladadas a hoy`);
      }
    }

    // Solo subir si hay tareas reales (protección anti-borrado)
    const taskCount = DB.query('SELECT COUNT(*) AS c FROM tasks')[0]?.c || 0;
    if (DB.isDirty && taskCount > 0) {
      await this._uploadDB();
    } else {
      DB.isDirty = false;
    }

    this._setSyncStatus('✓');
    this._setGroupMode(this.state.groupMode);
    this.refresh();

    // Auto-sync cada 60s
    if (this.state.syncTimer) clearInterval(this.state.syncTimer);
    this.state.syncTimer = setInterval(() => this._autoSync(), 60000);
  },

  async _autoSync() {
    if (this.state.syncing) return;
    if (!DB.isDirty) {
      // Solo descargar para ver si hay cambios desde el PC
      try {
        this.state.syncing = true;
        this._setSyncStatus('🔄');
        const meta = await DBX.getMetadata();
        if (meta && meta.rev !== DBX.state.lastDownloadedRev) {
          // Hay versión más reciente en Dropbox
          const result = await DBX.download();
          if (result) {
            DB.loadFromBytes(result.buffer);
            this.refresh();
            this._toast('🔄 Cambios sincronizados');
          }
        }
        this._setSyncStatus('✓');
      } catch (e) {
        console.error(e);
        this._setSyncStatus('⚠');
      } finally {
        this.state.syncing = false;
      }
    } else {
      await this._uploadDB();
    }
  },

  async _uploadDB() {
    if (this.state.syncing) return;
    // Protección: nunca subir una BD vacía (evita borrar datos reales en Dropbox)
    const taskCount = DB.query('SELECT COUNT(*) AS c FROM tasks')[0]?.c || 0;
    if (taskCount === 0) {
      console.warn('Subida cancelada: BD local sin tareas');
      DB.isDirty = false;
      return;
    }
    try {
      this.state.syncing = true;
      this._setSyncStatus('🔄');
      const data = DB.export();
      await DBX.upload(data);
      DB.isDirty = false;
      this._setSyncStatus('✓');
    } catch (e) {
      console.error(e);
      this._setSyncStatus('⚠');
      this._toast('Error al subir: ' + e.message);
    } finally {
      this.state.syncing = false;
    }
  },

  _setSyncStatus(s) {
    document.getElementById('sync-status').textContent = s;
  },

  /* ---------------- UI BINDINGS ---------------- */
  _bindUI() {
    document.getElementById('theme-btn').onclick = () => this._toggleTheme();
    document.getElementById('settings-btn').onclick = () => this._openSettings();
    document.getElementById('prev-day').onclick = () => this._changeDay(-1);
    document.getElementById('next-day').onclick = () => this._changeDay(1);
    document.getElementById('today-btn').onclick = () => {
      this.state.selectedDate = new Date();
      this.refresh();
    };
    document.getElementById('calendar-btn').onclick = () => this._toggleCalendar();
    document.getElementById('cal-prev-month').onclick = () => this._changeCalMonth(-1);
    document.getElementById('cal-next-month').onclick = () => this._changeCalMonth(1);
    document.getElementById('fab-add').onclick = () => this._openTaskModal();

    // Tabs
    document.querySelectorAll('.tab').forEach(t => {
      t.onclick = () => this._setActiveTab(t.dataset.tab);
    });

    document.getElementById('group-select').onchange = (e) => {
      this._setGroupMode(e.target.value);
      this.refresh();
    };

    // Cerrar modales
    document.querySelectorAll('[data-close]').forEach(b => {
      b.onclick = () => document.getElementById(b.dataset.close).classList.add('hidden');
    });

    // Modal de tarea
    document.getElementById('save-task-btn').onclick = () => this._saveTask();
    document.getElementById('new-cat-btn').onclick = () => this._addCategoryPrompt(true);
    document.getElementById('task-has-time').onchange = (e) => {
      document.getElementById('task-time').disabled = !e.target.checked;
    };

    // Settings
    document.getElementById('sync-now-btn').onclick = async () => {
      this._toast('🔄 Sincronizando...');
      await this._autoSync();
      this._toast('✓ Sincronizado');
    };
    document.getElementById('disconnect-btn').onclick = () => this._disconnect();
    document.getElementById('add-cat-btn').onclick = () => this._addCategoryPrompt(false);

    // Detail modal
    document.getElementById('edit-task-btn').onclick = () => {
      const id = this.state.detailTaskId;
      document.getElementById('detail-modal').classList.add('hidden');
      this._openTaskModal(id);
    };
    document.getElementById('delete-task-btn').onclick = () => {
      if (confirm('¿Eliminar esta tarea?')) {
        DB.deleteTask(this.state.detailTaskId);
        document.getElementById('detail-modal').classList.add('hidden');
        this.refresh();
        this._uploadDB();
      }
    };
  },

  _setActiveTab(tab) {
    this.state.activeTab = tab;
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    this.refresh();
  },

  _setGroupMode(mode) {
    this.state.groupMode = mode;
    localStorage.setItem('groupMode', mode);
    document.getElementById('group-select').value = mode;
  },

  _toggleTheme() {
    this.state.theme = this.state.theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', this.state.theme);
    localStorage.setItem('theme', this.state.theme);
    this._updateThemeBtn();
  },

  _updateThemeBtn() {
    document.getElementById('theme-btn').textContent =
      this.state.theme === 'light' ? '🌙' : '☀';
  },

  _changeDay(delta) {
    const d = new Date(this.state.selectedDate);
    d.setDate(d.getDate() + delta);
    this.state.selectedDate = d;
    this.refresh();
  },

  /* ---------------- CALENDARIO ---------------- */
  _toggleCalendar() {
    const popup = document.getElementById('calendar-popup');
    const isHidden = popup.classList.contains('hidden');
    if (isHidden) {
      this.state.calendarViewDate = new Date(this.state.selectedDate);
      this._renderCalendar();
      popup.classList.remove('hidden');
    } else {
      popup.classList.add('hidden');
    }
  },

  _changeCalMonth(delta) {
    const d = new Date(this.state.calendarViewDate);
    d.setMonth(d.getMonth() + delta);
    this.state.calendarViewDate = d;
    this._renderCalendar();
  },

  _renderCalendar() {
    const view = this.state.calendarViewDate;
    const year = view.getFullYear();
    const month = view.getMonth() + 1;
    document.getElementById('cal-title').textContent =
      `${MONTHS[month - 1]} ${year}`;

    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    const counts = DB.getTaskCountsByMonth(year, month);
    const firstDay = new Date(year, month - 1, 1);
    let firstWeekday = firstDay.getDay() - 1; // L=0
    if (firstWeekday < 0) firstWeekday = 6;
    const lastDay = new Date(year, month, 0).getDate();

    // Espacios vacíos antes del día 1
    for (let i = 0; i < firstWeekday; i++) {
      const e = document.createElement('div');
      e.className = 'day empty';
      grid.appendChild(e);
    }

    const today = new Date().toISOString().slice(0, 10);
    const sel = this._dateToString(this.state.selectedDate);

    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cell = document.createElement('div');
      cell.className = 'day';
      cell.textContent = d;

      if (counts[dateStr]) {
        if (counts[dateStr].pending > 0) {
          cell.classList.add('has-pending');
          // Color del punto según prioridad más alta
          const prios = ['urgente', 'alta', 'media', 'baja'];
          const top = prios.find(p => counts[dateStr].priorities.has(p));
          if (top) {
            cell.style.setProperty('--p-urgente', PRIORITY_COLORS[top]);
          }
        } else if (counts[dateStr].total > 0) {
          cell.classList.add('all-done');
        }
      }
      if (dateStr === today) cell.classList.add('today');
      if (dateStr === sel) cell.classList.add('selected');

      cell.onclick = () => {
        const [y, m, dd] = dateStr.split('-').map(Number);
        this.state.selectedDate = new Date(y, m - 1, dd);
        document.getElementById('calendar-popup').classList.add('hidden');
        this.refresh();
      };
      grid.appendChild(cell);
    }
  },

  _dateToString(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  /* ---------------- REFRESH ---------------- */
  refresh() {
    const d = this.state.selectedDate;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dCopy = new Date(d); dCopy.setHours(0, 0, 0, 0);
    const diffDays = Math.round((dCopy - today) / (1000 * 60 * 60 * 24));

    let mainText = `${WEEKDAYS[(d.getDay() + 6) % 7]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    let subText = '';
    if (diffDays === 0) subText = 'Hoy';
    else if (diffDays === 1) subText = 'Mañana';
    else if (diffDays === -1) subText = 'Ayer';
    else if (diffDays > 0) subText = `En ${diffDays} días`;
    else subText = `Hace ${-diffDays} días`;

    document.getElementById('date-main').textContent = mainText;
    document.getElementById('date-sub').textContent = `${subText} · ${d.getFullYear()}`;

    const dateStr = this._dateToString(d);
    const allTasks = DB.getTasksByDate(dateStr, true);
    const pending = allTasks.filter(t => !t.completed);
    const done = allTasks.filter(t => t.completed);

    document.getElementById('pending-count').textContent = pending.length;
    document.getElementById('done-count').textContent = done.length;

    const tasks = this.state.activeTab === 'pending' ? pending : done;
    this._renderTasks(tasks);
  },

  _renderTasks(tasks) {
    const container = document.getElementById('tasks-list');
    const empty = document.getElementById('empty-state');
    container.innerHTML = '';

    if (!tasks.length) {
      empty.classList.remove('hidden');
      empty.querySelector('p').textContent =
        this.state.activeTab === 'pending'
          ? 'No tienes tareas pendientes para este día'
          : 'Aún no has completado tareas este día';
      return;
    }
    empty.classList.add('hidden');

    const groups = this._groupTasks(tasks);
    for (const g of groups) {
      const header = document.createElement('div');
      header.className = 'group-header';
      header.style.borderColor = g.color;
      header.style.color = g.color;
      header.innerHTML = `
        <div class="dot" style="background:${g.color}"></div>
        <span>${this._escape(g.name)}</span>
        <span class="count" style="background:${g.color}">${g.tasks.length}</span>
      `;
      container.appendChild(header);

      for (const t of g.tasks) {
        container.appendChild(this._taskItem(t));
      }
    }
  },

  _groupTasks(tasks) {
    if (this.state.groupMode === 'priority') {
      const order = ['urgente', 'alta', 'media', 'baja'];
      const groups = {};
      for (const t of tasks) {
        if (!groups[t.priority]) groups[t.priority] = [];
        groups[t.priority].push(t);
      }
      return order
        .filter(p => groups[p])
        .map(p => ({
          name: PRIORITY_NAMES[p],
          color: PRIORITY_COLORS[p],
          tasks: groups[p].sort((a, b) =>
            (a.reminder_time || '99:99').localeCompare(b.reminder_time || '99:99'))
        }));
    } else {
      // por categoría
      const groups = {};
      for (const t of tasks) {
        const key = t.category_id || 'none';
        if (!groups[key]) {
          groups[key] = {
            id: t.category_id,
            name: t.category_name || 'Sin categoría',
            color: t.category_color || '#9ca3af',
            tasks: []
          };
        }
        groups[key].tasks.push(t);
      }
      const prioOrder = { urgente: 1, alta: 2, media: 3, baja: 4 };
      const arr = Object.values(groups);
      arr.sort((a, b) => {
        if (a.id === null) return 1;
        if (b.id === null) return -1;
        return a.name.localeCompare(b.name);
      });
      arr.forEach(g => g.tasks.sort((x, y) =>
        (prioOrder[x.priority] || 9) - (prioOrder[y.priority] || 9)
      ));
      return arr;
    }
  },

  _taskItem(t) {
    const div = document.createElement('div');
    div.className = `task-item priority-${t.priority}`;
    if (t.completed) div.classList.add('completed');

    div.innerHTML = `
      <div class="task-checkbox ${t.completed ? 'checked' : ''}">${t.completed ? '✓' : ''}</div>
      <div class="task-content">
        <div class="task-title">${this._escape(t.title)}</div>
        <div class="task-meta">
          <span class="task-badge" style="background:${PRIORITY_COLORS[t.priority]}">
            ${PRIORITY_NAMES[t.priority]}
          </span>
          ${t.reminder_time ? `<span class="task-time">🕐 ${t.reminder_time}</span>` : ''}
          ${t.rolled_over ? '<span class="task-rolled" title="Trasladada">🔄</span>' : ''}
        </div>
      </div>
    `;

    // Click en checkbox → toggle
    div.querySelector('.task-checkbox').onclick = (e) => {
      e.stopPropagation();
      this._toggleTask(t.id, !t.completed);
    };
    // Click en cuerpo → ver detalle
    div.querySelector('.task-content').onclick = () => this._openDetail(t.id);
    return div;
  },

  _toggleTask(id, completed) {
    DB.setTaskCompleted(id, completed);
    this.refresh();
    this._uploadDB();
  },

  /* ---------------- MODAL DE TAREA ---------------- */
  _openTaskModal(taskId = null) {
    this.state.editingTaskId = taskId;
    document.getElementById('task-modal-title').textContent =
      taskId ? 'Editar tarea' : 'Nueva tarea';

    // Reset
    document.getElementById('task-title').value = '';
    document.getElementById('task-priority').value = 'media';
    document.getElementById('task-has-time').checked = false;
    document.getElementById('task-time').disabled = true;
    document.getElementById('task-time').value = '09:00';
    document.getElementById('task-notes').value = '';

    this._populateCategorySelect();

    if (taskId) {
      const tasks = DB.query('SELECT * FROM tasks WHERE id=?', [taskId]);
      if (tasks.length) {
        const t = tasks[0];
        document.getElementById('task-title').value = t.title;
        document.getElementById('task-priority').value = t.priority;
        document.getElementById('task-category').value = t.category_id || '';
        if (t.reminder_time) {
          document.getElementById('task-has-time').checked = true;
          document.getElementById('task-time').disabled = false;
          document.getElementById('task-time').value = t.reminder_time;
        }
        document.getElementById('task-notes').value = t.notes || '';
      }
    }

    document.getElementById('task-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('task-title').focus(), 100);
  },

  _populateCategorySelect() {
    const sel = document.getElementById('task-category');
    sel.innerHTML = '<option value="">Sin categoría</option>';
    for (const c of DB.getCategories()) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      opt.style.background = c.color;
      sel.appendChild(opt);
    }
  },

  _saveTask() {
    const title = document.getElementById('task-title').value.trim();
    if (!title) {
      this._toast('Falta el título');
      return;
    }
    const priority = document.getElementById('task-priority').value;
    const catVal = document.getElementById('task-category').value;
    const category_id = catVal ? parseInt(catVal) : null;
    const hasTime = document.getElementById('task-has-time').checked;
    const reminder_time = hasTime ? document.getElementById('task-time').value : null;
    const notes = document.getElementById('task-notes').value.trim() || null;

    if (this.state.editingTaskId) {
      DB.updateTask(this.state.editingTaskId, {
        title, priority, category_id, reminder_time, notes
      });
    } else {
      DB.addTask({
        title, priority, category_id, reminder_time, notes,
        due_date: this._dateToString(this.state.selectedDate)
      });
    }

    document.getElementById('task-modal').classList.add('hidden');
    this.refresh();
    this._uploadDB();
  },

  _addCategoryPrompt(reloadAfter) {
    const name = prompt('Nombre de la nueva categoría:');
    if (!name || !name.trim()) return;
    const color = prompt('Color en formato HEX (ej: #4f46e5):', '#6b7280');
    if (!color) return;
    DB.addCategory(name.trim(), color);
    this._uploadDB();
    if (reloadAfter) this._populateCategorySelect();
    this._renderCategoriesList();
  },

  /* ---------------- DETALLE DE TAREA ---------------- */
  _openDetail(id) {
    this.state.detailTaskId = id;
    const tasks = DB.query('SELECT t.*, c.name AS category_name, c.color AS category_color FROM tasks t LEFT JOIN categories c ON t.category_id = c.id WHERE t.id=?', [id]);
    if (!tasks.length) return;
    const t = tasks[0];
    document.getElementById('detail-title').textContent = t.title;
    const subtasks = DB.getSubtasks(id);

    let html = '';
    html += `<div class="detail-section">
      <div class="detail-label">Prioridad</div>
      <div class="detail-value">
        <span class="task-badge" style="background:${PRIORITY_COLORS[t.priority]}">
          ${PRIORITY_NAMES[t.priority]}
        </span>
      </div>
    </div>`;

    if (t.category_name) {
      html += `<div class="detail-section">
        <div class="detail-label">Categoría</div>
        <div class="detail-value">
          <span class="task-badge" style="background:${t.category_color}">
            ${this._escape(t.category_name)}
          </span>
        </div>
      </div>`;
    }

    if (t.reminder_time) {
      html += `<div class="detail-section">
        <div class="detail-label">Recordatorio</div>
        <div class="detail-value">🕐 ${t.reminder_time}</div>
      </div>`;
    }

    if (t.notes) {
      html += `<div class="detail-section">
        <div class="detail-label">Notas</div>
        <div class="detail-value">${this._escape(t.notes).replace(/\n/g, '<br>')}</div>
      </div>`;
    }

    html += `<div class="detail-section">
      <div class="detail-label">Subtareas (${subtasks.length})</div>
      <div id="subtasks-container"></div>
      <button class="add-subtask-btn" id="add-sub-btn">➕ Añadir subtarea</button>
    </div>`;

    document.getElementById('detail-body').innerHTML = html;

    const container = document.getElementById('subtasks-container');
    for (const st of subtasks) {
      const row = document.createElement('div');
      row.className = 'detail-subtask' + (st.completed ? ' completed' : '');
      row.innerHTML = `
        <div class="task-checkbox ${st.completed ? 'checked' : ''}">${st.completed ? '✓' : ''}</div>
        <span style="flex:1">${this._escape(st.title)}</span>
        <button style="padding:4px 8px;color:var(--text-soft)">✕</button>
      `;
      row.querySelector('.task-checkbox').onclick = () => {
        DB.setSubtaskCompleted(st.id, !st.completed);
        // Auto-completar tarea padre si todas las subtareas están listas
        const all = DB.allSubtasksCompleted(id);
        if (all && !t.completed) DB.setTaskCompleted(id, true);
        else if (!all && t.completed) DB.setTaskCompleted(id, false);
        this._openDetail(id);
        this.refresh();
        this._uploadDB();
      };
      row.querySelector('button').onclick = () => {
        DB.deleteSubtask(st.id);
        this._openDetail(id);
        this._uploadDB();
      };
      container.appendChild(row);
    }

    document.getElementById('add-sub-btn').onclick = () => {
      const title = prompt('Nueva subtarea:');
      if (title && title.trim()) {
        DB.addSubtask(id, title.trim());
        this._openDetail(id);
        this._uploadDB();
      }
    };

    document.getElementById('detail-modal').classList.remove('hidden');
  },

  /* ---------------- AJUSTES ---------------- */
  _openSettings() {
    document.getElementById('sync-account').textContent =
      DBX.state.accountName ? `Conectado como: ${DBX.state.accountName}` : 'Conectado a Dropbox';
    this._renderCategoriesList();
    document.getElementById('settings-modal').classList.remove('hidden');
  },

  _renderCategoriesList() {
    const cont = document.getElementById('categories-list');
    cont.innerHTML = '';
    const cats = DB.getCategories();
    if (!cats.length) {
      cont.innerHTML = '<p style="color:var(--text-soft)">Sin categorías</p>';
      return;
    }
    for (const c of cats) {
      const row = document.createElement('div');
      row.className = 'cat-row';
      row.innerHTML = `
        <input type="color" class="cat-color" value="${c.color}" style="width:24px;height:24px;border:none;background:none;padding:0">
        <span class="cat-name">${this._escape(c.name)}</span>
        <div class="cat-actions">
          <button class="rename-btn">✏</button>
          <button class="delete-btn">🗑</button>
        </div>
      `;
      row.querySelector('.cat-color').onchange = (e) => {
        DB.updateCategory(c.id, c.name, e.target.value);
        this._uploadDB();
        this.refresh();
      };
      row.querySelector('.rename-btn').onclick = () => {
        const newName = prompt('Nuevo nombre:', c.name);
        if (newName && newName.trim()) {
          DB.updateCategory(c.id, newName.trim(), c.color);
          this._renderCategoriesList();
          this._uploadDB();
          this.refresh();
        }
      };
      row.querySelector('.delete-btn').onclick = () => {
        if (confirm(`¿Eliminar la categoría "${c.name}"?`)) {
          DB.deleteCategory(c.id);
          this._renderCategoriesList();
          this._uploadDB();
          this.refresh();
        }
      };
      cont.appendChild(row);
    }
  },

  _disconnect() {
    if (!confirm('¿Desconectar Dropbox? Tendrás que volver a configurarlo.')) return;
    DBX.disconnect();
    location.reload();
  },

  /* ---------------- UTILS ---------------- */
  _escape(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  },

  _toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 8000);
  }
};

// Desregistrar cualquier Service Worker antiguo que pueda estar bloqueando peticiones
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    for (const reg of regs) reg.unregister();
  });
}

// Antes de cerrar/recargar, intentar subir cambios pendientes
window.addEventListener('beforeunload', () => {
  if (DB.isDirty && DBX.isConfigured()) {
    try {
      const data = DB.export();
      navigator.sendBeacon(
        'https://content.dropboxapi.com/2/files/upload',
        new Blob([data])
      );
    } catch (e) {}
  }
});

// Init
window.addEventListener('DOMContentLoaded', () => App.init());
