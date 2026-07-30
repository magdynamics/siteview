import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';

const STATUS_COLOR = {
  assigned: '#888', acknowledged: '#1565c0', in_progress: '#e65100',
  blocked: '#b71c1c', complete: '#2e7d32',
};

function toISODate(d) { return d.toISOString().split('T')[0]; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function startOfWeek(d) { const r = new Date(d); const day = r.getDay(); return addDays(r, -day); }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

// Drag-and-drop scheduling calendar: reschedule tasks by dragging cards
// between days, or reassign by dragging onto a resource in the day sidebar.
export default function SchedulingView({ siteId }) {
  const [view, setView] = useState('week'); // 'day' | 'week' | 'month'
  const [anchor, setAnchor] = useState(new Date());
  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [dragTaskId, setDragTaskId] = useState(null);
  const [conflictNote, setConflictNote] = useState(null);

  const range = useMemo(() => {
    if (view === 'day') return { start: anchor, end: anchor };
    if (view === 'week') { const s = startOfWeek(anchor); return { start: s, end: addDays(s, 6) }; }
    const s = startOfMonth(anchor);
    const gridStart = startOfWeek(s);
    const gridEnd = addDays(gridStart, 41); // 6 full weeks, covers any month
    return { start: gridStart, end: gridEnd };
  }, [view, anchor]);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const [t, e] = await Promise.all([
        api.get(`/tasks/calendar?siteId=${siteId}&startDate=${toISODate(range.start)}&endDate=${toISODate(range.end)}`),
        api.get(`/employees?siteId=${siteId}`),
      ]);
      setTasks(t.data);
      setEmployees(e.data);
    } catch (err) { alert(err.response?.data?.error || 'Failed to load schedule'); }
  }, [siteId, range]);

  useEffect(() => { load(); }, [load]);

  const tasksByDate = useMemo(() => {
    const map = {};
    tasks.forEach(t => { (map[t.scheduledDate] = map[t.scheduledDate] || []).push(t); });
    return map;
  }, [tasks]);

  const days = useMemo(() => {
    const list = [];
    let d = range.start;
    while (d <= range.end) { list.push(new Date(d)); d = addDays(d, 1); }
    return list;
  }, [range]);

  const reschedule = async (taskId, scheduledDate, assignedTo) => {
    try {
      const res = await api.patch(`/tasks/${taskId}/reschedule`, { scheduledDate, ...(assignedTo ? { assignedTo } : {}) });
      if (res.data.conflicts?.length) {
        setConflictNote(res.data.conflicts.map(c =>
          c.type === 'employee'
            ? `⚠️ ${c.name} is also booked on "${c.conflictingTask}" at another site that day`
            : `⚠️ Equipment is also booked on "${c.conflictingTask}" at another site that day`
        ).join('\n'));
      }
      load();
    } catch (err) { alert(err.response?.data?.error || 'Reschedule failed'); }
  };

  const nav = (dir) => {
    if (view === 'day') setAnchor(a => addDays(a, dir));
    else if (view === 'week') setAnchor(a => addDays(a, dir * 7));
    else setAnchor(a => new Date(a.getFullYear(), a.getMonth() + dir, 1));
  };

  const label = view === 'day'
    ? anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    : view === 'week'
      ? `${range.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${range.end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div>
      <div style={styles.toolbar}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={styles.navBtn} onClick={() => nav(-1)}>◀</button>
          <div style={styles.periodLabel}>{label}</div>
          <button style={styles.navBtn} onClick={() => nav(1)}>▶</button>
          <button style={{ ...styles.smallBtn, background: '#1a237e' }} onClick={() => setAnchor(new Date())}>Today</button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['day', 'week', 'month'].map(v => (
            <button
              key={v}
              style={{ ...styles.viewBtn, ...(view === v ? styles.viewBtnActive : {}) }}
              onClick={() => setView(v)}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {conflictNote && (
        <div style={styles.conflictBanner}>
          <pre style={{ margin: 0, fontFamily: 'inherit', whiteSpace: 'pre-wrap' }}>{conflictNote}</pre>
          <button style={styles.conflictClose} onClick={() => setConflictNote(null)}>Dismiss</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          {view === 'day' && (
            <DayColumn
              date={days[0]}
              tasks={tasksByDate[toISODate(days[0])] || []}
              onDragStart={setDragTaskId}
              onDrop={(date) => dragTaskId && reschedule(dragTaskId, date)}
            />
          )}
          {view === 'week' && (
            <div style={styles.weekGrid}>
              {days.map(d => (
                <DayCell
                  key={d.toISOString()}
                  date={d}
                  tasks={tasksByDate[toISODate(d)] || []}
                  compact={false}
                  onDragStart={setDragTaskId}
                  onDrop={(date) => dragTaskId && reschedule(dragTaskId, date)}
                />
              ))}
            </div>
          )}
          {view === 'month' && (
            <div style={styles.monthGrid}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(h => (
                <div key={h} style={styles.monthHeader}>{h}</div>
              ))}
              {days.map(d => (
                <DayCell
                  key={d.toISOString()}
                  date={d}
                  tasks={tasksByDate[toISODate(d)] || []}
                  compact
                  dimmed={d.getMonth() !== anchor.getMonth()}
                  onDragStart={setDragTaskId}
                  onDrop={(date) => dragTaskId && reschedule(dragTaskId, date)}
                />
              ))}
            </div>
          )}
        </div>

        {view === 'day' && (
          <div style={styles.sidebar}>
            <div style={styles.sidebarTitle}>Crew — drop a task here to reassign</div>
            {employees.map(e => (
              <div
                key={e.uid}
                style={styles.resourceRow}
                onDragOver={ev => ev.preventDefault()}
                onDrop={() => dragTaskId && reschedule(dragTaskId, toISODate(days[0]), e.uid)}
              >
                <span>{e.name}</span>
              </div>
            ))}
            {employees.length === 0 && <div style={{ fontSize: 12, color: '#aaa' }}>No employees at this site</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function DayColumn({ date, tasks, onDragStart, onDrop }) {
  return (
    <div
      style={{ ...styles.dayColumn }}
      onDragOver={e => e.preventDefault()}
      onDrop={() => onDrop(toISODate(date))}
    >
      {tasks.length === 0 && <div style={styles.emptyDay}>No tasks scheduled</div>}
      {tasks.map(t => <TaskCard key={t.id} task={t} draggable onDragStart={() => onDragStart(t.id)} full />)}
    </div>
  );
}

function DayCell({ date, tasks, compact, dimmed, onDragStart, onDrop }) {
  const isToday = toISODate(date) === toISODate(new Date());
  return (
    <div
      style={{ ...styles.dayCell, ...(dimmed ? styles.dayCellDimmed : {}), ...(isToday ? styles.dayCellToday : {}) }}
      onDragOver={e => e.preventDefault()}
      onDrop={() => onDrop(toISODate(date))}
    >
      <div style={styles.dayCellDate}>{date.getDate()}</div>
      {tasks.slice(0, compact ? 3 : undefined).map(t => (
        <TaskCard
          key={t.id}
          task={t}
          draggable
          compact={compact}
          onDragStart={() => onDragStart(t.id)}
        />
      ))}
      {compact && tasks.length > 3 && <div style={styles.moreLabel}>+{tasks.length - 3} more</div>}
    </div>
  );
}

function TaskCard({ task, draggable, onDragStart, compact, full }) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      style={{
        ...styles.taskCard,
        ...(compact ? styles.taskCardCompact : {}),
        ...(full ? styles.taskCardFull : {}),
        borderLeft: `4px solid ${STATUS_COLOR[task.status] || '#888'}`,
      }}
      title={`${task.title} — ${task.assignedToName}`}
    >
      <div style={styles.taskCardTitle}>{task.title}</div>
      {!compact && <div style={styles.taskCardMeta}>{task.assignedToName}</div>}
    </div>
  );
}

const styles = {
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  navBtn: { background: '#fff', border: '1px solid #ddd', borderRadius: 6, width: 32, height: 32, cursor: 'pointer', fontSize: 13 },
  periodLabel: { fontSize: 15, fontWeight: 600, color: '#333', minWidth: 200, textAlign: 'center' },
  viewBtn: { background: '#fff', border: '1px solid #ddd', color: '#555', padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  viewBtnActive: { background: '#1a237e', color: '#fff', borderColor: '#1a237e' },
  smallBtn: { color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13 },
  conflictBanner: { background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 12, color: '#e65100', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  conflictClose: { background: 'transparent', border: 'none', color: '#e65100', cursor: 'pointer', fontSize: 12, textDecoration: 'underline', flexShrink: 0 },
  weekGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 },
  monthGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 },
  monthHeader: { fontSize: 11, color: '#888', textAlign: 'center', fontWeight: 600, padding: '4px 0' },
  dayColumn: { background: '#fff', borderRadius: 12, padding: 14, minHeight: 400, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  dayCell: { background: '#fff', borderRadius: 10, padding: 8, minHeight: 110, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  dayCellDimmed: { opacity: 0.4 },
  dayCellToday: { border: '2px solid #1a237e' },
  dayCellDate: { fontSize: 11, color: '#888', fontWeight: 700, marginBottom: 6 },
  emptyDay: { fontSize: 12, color: '#ccc', textAlign: 'center', padding: 20 },
  moreLabel: { fontSize: 10, color: '#888', marginTop: 2 },
  taskCard: { background: '#f5f6fa', borderRadius: 6, padding: '6px 8px', marginBottom: 6, cursor: 'grab', fontSize: 12 },
  taskCardCompact: { padding: '3px 6px', marginBottom: 3, fontSize: 10 },
  taskCardFull: { padding: '10px 12px', fontSize: 13 },
  taskCardTitle: { fontWeight: 600, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  taskCardMeta: { color: '#888', fontSize: 11, marginTop: 2 },
  sidebar: { width: 220, background: '#fff', borderRadius: 12, padding: 14, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', alignSelf: 'flex-start' },
  sidebarTitle: { fontSize: 11, color: '#888', fontWeight: 700, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  resourceRow: { padding: '10px 10px', borderRadius: 8, border: '1px dashed #ddd', marginBottom: 8, fontSize: 13, color: '#333' },
};
