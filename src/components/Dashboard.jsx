import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ROOMS, FLOORS, CLEANING_TYPES, STATUS_COLORS } from '../data/rooms';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { 
  subscribeToTasks, 
  subscribeToStaff,
  setTask, 
  updateTaskStatus, 
  assignTask,
  batchAssignTasks,
  batchSetTasks,
  resetDailyPlanning,
  setLateCheckout,
  clearLateCheckout,
  updateStaffPresence,
  updateStaffShift,
  autoAssignTasks,
  resetAllTasks,
  ensureAllRoomsHaveTasks,
  deleteTask,
  setStaff as saveStaffToFirestore,
  deleteStaff,
  subscribeToReports,
  generateAndSaveReport,
  migrateTasksSchema,
  startTask,
  finishTask,
  markAsDND,
  cancelDND,
  postponeTask,
  cancelPostpone,
  markAsFreed,
  clearFreed,
  getTaskDisplayStatus,
  canModifyTask
} from '../services/firestore';
import { handlePrint, printSheets, printReport } from '../services/print';
import { parseMedialogFile } from '../services/import';

export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const [tasks, setTasks] = useState([]);
  const [staff, setStaff] = useState([]);
  const [filterStaff, setFilterStaff] = useState('all');
  const [selectedRooms, setSelectedRooms] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [showTeamPanel, setShowTeamPanel] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importedTasks, setImportedTasks] = useState([]);
  const [importedFileDate, setImportedFileDate] = useState(null);
  const [dateWarning, setDateWarning] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [lateCheckoutTime, setLateCheckoutTime] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState('planning'); // 'planning' | 'reports'
  const [selectedReport, setSelectedReport] = useState(null);
  const [reports, setReports] = useState([]);

  // Get today's date formatted
  const today = new Date();
  const dateStr = today.toLocaleDateString('fr-FR', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  // Subscribe to realtime updates
  useEffect(() => {
    // Load saved language
    const savedLang = localStorage.getItem('language');
    if (savedLang && ['fr', 'en', 'ro'].includes(savedLang)) {
      i18n.changeLanguage(savedLang);
    }

    let unsubStaff;
    
    const init = async () => {
      // Ensure all rooms have tasks (create if missing)
      await ensureAllRoomsHaveTasks();
      
      // Run migration if needed (one-time)
      await migrateTasksSchema();
      
      // Subscribe to staff
      unsubStaff = subscribeToStaff((staffList) => {
        if (staffList && Array.isArray(staffList)) {
          setStaff(staffList);
        }
      });
    };
    
    init();
    
    const unsubTasks = subscribeToTasks((taskList) => {
      setTasks(taskList);
      setLoading(false);
    });
    
    const unsubReports = subscribeToReports((reportsList) => {
      setReports(reportsList);
    });
    
    return () => {
      unsubTasks();
      if (unsubStaff) unsubStaff();
      if (unsubReports) unsubReports();
    };
  }, []);

  // Get present staff only
  const presentStaff = Array.isArray(staff) ? staff.filter(s => s.presentToday) : [];

  // Get task for a room
  const getTaskForRoom = (room) => {
    return tasks.find(t => t.roomId === room.id) || null;
  };

  // Computed stats (new schema)
  const totalRooms = ROOMS.length;
  const doneCount = tasks.filter(t => t.cleaning_status === 'done' ).length;
  const progress = totalRooms > 0 ? Math.round((doneCount / totalRooms) * 100) : 0;

  // Stats per staff member (new schema)
  const staffStats = Array.isArray(staff) ? staff.map(s => {
    const assigned = tasks.filter(t => t.cleaning_assignedTo === s.id).length;
    const done = tasks.filter(t => t.cleaning_assignedTo === s.id && (t.cleaning_status === 'done' )).length;
    return { ...s, assigned, done };
  }).filter(s => s.presentToday) : [];

  // Filter rooms (new schema)
  const filteredRooms = ROOMS.filter(room => {
    const task = getTaskForRoom(room);
    
    if (filterStaff !== 'all') {
      if (task?.cleaning_assignedTo !== filterStaff) {
        return false;
      }
      if (!task?.cleaning_assignedTo) return false;
    }
    return true;
  });

  // Check if selected filter has no rooms
  const hasNoAssignedRooms = filterStaff !== 'all' && filteredRooms.length === 0 && !loading;

  // Group by floor
  const roomsByFloor = FLOORS.reduce((acc, floor) => {
    acc[floor] = filteredRooms.filter(r => r.floor === floor);
    return acc;
  }, {});

  // Selection handler - click vs drag
  const dragTimerRef = useRef(null);
  const isDraggingRef = useRef(false);

  const handleRoomMouseDown = (room, e) => {
    const task = getTaskForRoom(room);
    if (task && (task.status === 'in_progress' || task.status === 'done' || task.status === 'ready')) {
      return;
    }
    
    // Start drag timer (150ms)
    dragTimerRef.current = setTimeout(() => {
      isDraggingRef.current = true;
      setIsDragging(true);
      setSelectedRooms(new Set([room.id]));
    }, 150);
  };

  const handleRoomMouseUp = (room) => {
    // If drag timer still running, it's a click
    if (dragTimerRef.current) {
      clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
      
      // Toggle selection on click
      const task = getTaskForRoom(room);
      if (!task || (task.status !== 'in_progress' && task.status !== 'done')) {
        const newSelection = new Set(selectedRooms);
        if (newSelection.has(room.id)) {
          newSelection.delete(room.id);
        } else {
          newSelection.add(room.id);
        }
        setSelectedRooms(newSelection);
      }
    }
    isDraggingRef.current = false;
    setIsDragging(false);
  };

  const handleRoomMouseEnter = (room) => {
    if (isDragging) {
      const task = getTaskForRoom(room);
      if (task && (task.status === 'in_progress' || task.status === 'done' || task.status === 'ready')) {
        return;
      }
      setSelectedRooms(prev => new Set([...prev, room.id]));
    }
  };

  const handleMouseUp = () => {
    if (dragTimerRef.current) {
      clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
    }
    isDraggingRef.current = false;
    setIsDragging(false);
  };

  const clearSelection = () => {
    setSelectedRooms(new Set());
  };

  // Check if can change assignment (only if not in_progress or done)
  const canChangeAssignment = (roomId) => {
    const task = getTaskForRoom(ROOMS.find(r => r.id === roomId));
    if (!task) return true;
    const status = task.cleaning_status || 'todo';
    const skipReason = task.cleaning_skip_reason || null;
    // Can't change if in_progress, done, ready, dnd, or postponed
    if (status === 'in_progress' || status === 'done' || status === 'ready' || skipReason === 'dnd' || skipReason === 'postponed') return false;
    return true;
  };

  // Check if can change status (only if todo)
  const canChangeStatus = (roomId) => {
    const task = getTaskForRoom(ROOMS.find(r => r.id === roomId));
    if (!task) return true;
    const status = task.cleaning_status || 'todo';
    if (status !== 'todo') return false;
    return true;
  };

  // Check if can change late checkout (not if in_progress, done, dnd, or postponed)
  const canChangeLateCheckout = (roomId) => {
    const task = getTaskForRoom(ROOMS.find(r => r.id === roomId));
    if (!task) return true;
    const status = task.cleaning_status || 'todo';
    const skipReason = task.cleaning_skip_reason || null;
    // Can't change if in_progress, done, ready, dnd, or postponed (but freed is OK - will clear freed)
    if (status === 'in_progress' || status === 'done' || status === 'ready' || skipReason === 'dnd' || skipReason === 'postponed') return false;
    return true;
  };

  // Create task if doesn't exist (new schema)
  const ensureTaskExists = async (roomId) => {
    const room = ROOMS.find(r => r.id === roomId);
    const task = getTaskForRoom(room);
    if (!task) {
      await setTask({
        roomId: room.id,
        roomNumber: room.number,
        floor: room.floor,
        cleaning_type: 'blanc',
        cleaning_status: 'todo',
        cleaning_assignedTo: null,
        cleaning_incident: null
      });
    }
  };

  // Actions
  const handleAssign = async (staffId) => {
    if (selectedRooms.size === 0) return;
    
    for (const roomId of selectedRooms) {
      if (canChangeAssignment(roomId)) {
        await ensureTaskExists(roomId);
        await assignTask(roomId, staffId);
      }
    }
  };

  const handleTypeChange = async (type) => {
    if (selectedRooms.size === 0) return;
    
    for (const roomId of selectedRooms) {
      if (!canChangeStatus(roomId)) continue;
      
      const room = ROOMS.find(r => r.id === roomId);
      const task = getTaskForRoom(room);
      if (!task) {
        await setTask({
          roomId: room.id,
          roomNumber: room.number,
          floor: room.floor,
          cleaning_type: type,
          cleaning_status: 'todo',
          cleaning_assignedTo: null,
          cleaning_incident: null
        });
      } else {
        await setTask({
          ...task,
          cleaning_type: type,
          roomId: room.id,
          roomNumber: room.number,
          floor: room.floor
        });
      }
    }
  };

  const handleLateCheckout = async () => {
    if (selectedRooms.size === 0 || !lateCheckoutTime) return;
    
    for (const roomId of selectedRooms) {
      if (!canChangeLateCheckout(roomId)) continue;
      await ensureTaskExists(roomId);
      // Set late checkout (can coexist with freed)
      await setLateCheckout(roomId, lateCheckoutTime);
    }
    setLateCheckoutTime('');
  };

  const handleDelete = async () => {
    if (selectedRooms.size === 0) return;
    
    for (const roomId of selectedRooms) {
      await deleteTask(roomId);
    }
    clearSelection();
  };

  // Marquer comme terminé depuis la réception
  const handleFinishFromReception = async () => {
    if (selectedRooms.size === 0) return;
    
    for (const roomId of selectedRooms) {
      await updateTaskStatus(roomId, 'done');
    }
    setShowFinishConfirm(false);
    clearSelection();
  };

  // Liberer a room (guest left, needs cleaning) - set to todo
  const handleFree = async () => {
    if (selectedRooms.size === 0) return;
    
    for (const roomId of selectedRooms) {
      if (!canChangeAssignment(roomId)) continue;
      await ensureTaskExists(roomId);
      // Set freed and clear late checkout (they are mutually exclusive)
      await markAsFreed(roomId);
      await clearLateCheckout(roomId);
    }
    clearSelection();
  };

  const handleResetAll = async () => {
    await resetAllTasks(tasks);
    setShowResetConfirm(false);
  };

  const handleAutoAssign = async () => {
    // Get tasks that are not done, not ready, not in_progress, not skipped
    const tasksToAssign = tasks.filter(t => (t.cleaning_status === 'todo' ) && t.cleaning_skip_reason === null);
    await autoAssignTasks(tasksToAssign, staff);
  };

  // Import handlers
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    console.log('File selected:', file.name);
    setIsImporting(true);
    try {
      const result = await parseMedialogFile(file);
      if (result && result.tasks) {
        setImportedTasks(result.tasks || []);
        setImportedFileDate(result.fileDate);
        setDateWarning(result.dateWarning || null);
        if (result.tasks.length === 0) {
          alert('Aucune chambre détectée dans le fichier. Vérifiez le format.');
        }
      } else {
        setImportedTasks([]);
        setImportedFileDate(null);
        setDateWarning(null);
        alert('Erreur lors de l\'import: format inattendu');
      }
    } catch (error) {
      console.error('Import error:', error);
      alert('Erreur lors de l\'import: ' + error.message);
    }
    setIsImporting(false);
  };

  const confirmImport = async () => {
    if (importedTasks.length === 0) return;
    
    // Get all current room IDs
    const currentRoomIds = new Set(tasks.map(t => t.roomId));
    const importedRoomIds = new Set(importedTasks.map(t => t.roomId));
    
    // Find rooms not in import - mark them as done
    const roomsToMarkDone = tasks.filter(t => !importedRoomIds.has(t.roomId));
    
    // Import the rooms from file
    await batchSetTasks(importedTasks);
    
    // Mark absent rooms as done
    for (const room of roomsToMarkDone) {
      await updateTaskStatus(room.roomId, 'done');
    }
    
    setShowImportModal(false);
    setImportedTasks([]);
    setImportedFileDate(null);
  };

  // Team management
  const toggleStaffPresence = async (staffId, present) => {
    await updateStaffPresence(staffId, present);
  };

  const [staffNameError, setStaffNameError] = useState(false);

  const handleAddStaff = async () => {
    if (!newStaffName.trim()) {
      setStaffNameError(true);
      return;
    }
    setStaffNameError(false);
    
    // Keep original case for ID (replace spaces with dashes)
    const newId = newStaffName.trim().replace(/\s+/g, '-');
    await saveStaffToFirestore({
      id: newId,
      name: newStaffName,
      language: 'FR',
      presentToday: true
    });
    setNewStaffName('');
  };

  // Check if any selected room can be modified
  const canModifySelected = Array.from(selectedRooms).some(roomId => canChangeAssignment(roomId));
  const canChangeTypeForSelected = Array.from(selectedRooms).some(roomId => canChangeStatus(roomId));
  const canChangeLateCheckoutForSelected = Array.from(selectedRooms).some(roomId => canChangeLateCheckout(roomId));

  // Check if auto-assign is allowed (only if there are todo or ready tasks with no skip reason)
  const canAutoAssign = tasks.some(t => (t.cleaning_status === 'todo' ) && t.cleaning_skip_reason === null);

  // Check if reset is allowed (only if no tasks in progress)
  const canReset = !tasks.some(t => t.cleaning_status === 'in_progress');

  // Helper functions (new schema)
  const getStatusClass = (task) => {
    if (!task) return 'status-todo';
    const status = getTaskDisplayStatus(task);
    return `status-${status}`;
  };

  const getCardStyle = (task, isSelected) => {
    const status = getTaskDisplayStatus(task);
    const isAssigned = task?.cleaning_assignedTo;
    const selectable = canModifyTask(task);
    
    let bgColor = STATUS_COLORS[status] || '#FFFFFF';
    let borderColor = '#D1D5DB'; // gray-300
    let borderWidth = 2;
    
    // Assigned = gray border (not blue, blue is for selection)
    if (isAssigned && status !== 'in_progress' && status !== 'done') {
      borderColor = '#9CA3AF'; // gray-400
    }
    
    // Selected = blue border
    if (isSelected) {
      borderColor = '#2563EB';
      borderWidth = 3;
      bgColor = '#EFF6FF'; // light blue background
    }
    
    return {
      backgroundColor: bgColor,
      borderColor,
      borderWidth,
      borderStyle: 'solid',
      userSelect: 'none',
      cursor: selectable ? 'pointer' : 'default'
    };
  };

  const canSelect = (task) => {
    if (!task) return true;
    return canModifyTask(task);
  };

  if (loading) {
    return <div className="app"><div className="main">Chargement...</div></div>;
  }

  return (
    <div className="app" onMouseUp={handleMouseUp}>
      <header className="header">
        <div>
          <h1>🏨 Hôtel SUB</h1>
          <p style={{ fontSize: 12, color: '#6B7280' }}>{dateStr}</p>
        </div>
        <div className="header-actions" style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={() => setShowTeamPanel(true)}>
            Équipe
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowImportModal(true)}>
            Importer
          </Button>
          <Button variant="outline" size="sm" onClick={() => handlePrint(staff, tasks)}>
            🖨️ Imprimer
          </Button>
          <Button variant="outline" size="sm" onClick={async () => {
            if (confirm('Générer le rapport du jour ?')) {
              await generateAndSaveReport(tasks, staff);
              alert('Rapport généré !');
            }
          }}>
            📊 Rapport
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', marginBottom: 16 }}>
        <button
          onClick={() => { setActiveTab('planning'); setSelectedReport(null); }}
          style={{
            padding: '12px 24px',
            border: 'none',
            background: activeTab === 'planning' ? '#3B82F6' : 'transparent',
            color: activeTab === 'planning' ? 'white' : '#6B7280',
            fontWeight: 600,
            cursor: 'pointer',
            borderRadius: '8px 8px 0 0',
            marginRight: 4
          }}
        >
          {t('allRooms')}
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          style={{
            padding: '12px 24px',
            border: 'none',
            background: activeTab === 'reports' ? '#3B82F6' : 'transparent',
            color: activeTab === 'reports' ? 'white' : '#6B7280',
            fontWeight: 600,
            cursor: 'pointer',
            borderRadius: '8px 8px 0 0'
          }}
        >
          {t('reports')}
        </button>
      </div>

      <main className="main" onClick={(e) => {
        if (e.target.closest('.bottom-panel') || e.target.closest('.btn') || e.target.closest('.modal')) return;
      }}>
        {/* Reports Tab */}
        {activeTab === 'reports' && (
          selectedReport ? (
            <ReportDetail report={selectedReport} onBack={() => setSelectedReport(null)} tasks={tasks} staff={staff} />
          ) : (
            <ReportsList reports={reports} onSelect={setSelectedReport} />
          )
        )}

        {/* Planning Tab */}
        {activeTab === 'planning' && (
        <div className="planning-content">
        <div className="progress-bar">
          <div className="stats">
            <span>{doneCount}/{totalRooms} terminées</span>
            <span>{progress}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
          {staffStats.length > 0 && (
            <div className="staff-progress" style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#6B7280' }}>
              {staffStats.filter(s => s.presentToday).map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F3F4F6', padding: '6px 12px', borderRadius: 8 }}>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  <span>{s.done}/{s.assigned}</span>
                  <input 
                    type="time"
                    value={s.shift_start || ''}
                    onChange={(e) => updateStaffShift(s.id, e.target.value, s.shift_end)}
                    style={{ padding: '2px 4px', fontSize: 11, borderRadius: 4, border: '1px solid #D1D5DB', width: 70 }}
                    title="Début"
                  />
                  <span>—</span>
                  <input 
                    type="time"
                    value={s.shift_end || ''}
                    onChange={(e) => updateStaffShift(s.id, s.shift_start, e.target.value)}
                    style={{ padding: '2px 4px', fontSize: 11, borderRadius: 4, border: '1px solid #D1D5DB', width: 70 }}
                    title="Fin"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="filters" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {filterStaff === 'all' ? 'Toutes les chambres' : staff.find(s => s.id === filterStaff)?.name || 'Toutes les chambres'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setFilterStaff('all')}>
                Toutes les chambres
              </DropdownMenuItem>
              {Array.isArray(staff) && staff.map(s => (
                <DropdownMenuItem key={s.id} onClick={() => setFilterStaff(s.id)}>
                  {s.name} {s.presentToday ? '' : '(absente)'}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          
          <Button variant="secondary" size="sm" onClick={handleAutoAssign} disabled={!canAutoAssign}>
            Auto-assigner
          </Button>
          
          <Button variant="secondary" size="sm" onClick={() => setShowResetConfirm(true)} disabled={!canReset}>
            Réinitialiser
          </Button>
        </div>

        {/* No rooms message */}
        {hasNoAssignedRooms && (
          <div className="no-rooms-message">
            <p>Aucune chambre assignée</p>
          </div>
        )}

        {/* Rooms by floor - full width */}
        {!hasNoAssignedRooms && FLOORS.map(floor => {
          const floorRooms = roomsByFloor[floor];
          if (floorRooms.length === 0) return null;
          
          return (
            <div key={floor} className="floor-section floor-section-full">
              <div className="floor-title">{floor}</div>
              <div className="rooms-grid rooms-grid-full">
                {floorRooms.map(room => {
                  const task = getTaskForRoom(room);
                  const assignedStaff = task?.cleaning_assignedTo ? (Array.isArray(staff) && staff.find(s => s.id === task.cleaning_assignedTo)) : null;
                  const displayStatus = getTaskDisplayStatus(task);
                  const isSelected = selectedRooms.has(room.id);
                  
                  return (
                    <div 
                      key={room.id} 
                      className={`room-card ${getStatusClass(task)}`}
                      onMouseDown={(e) => handleRoomMouseDown(room, e)}
                      onMouseUp={() => handleRoomMouseUp(room)}
                      onMouseEnter={() => handleRoomMouseEnter(room)}
                      style={getCardStyle(task, isSelected)}
                      title={displayStatus === 'dnd' ? 'Ne pas déranger' : (task?.cleaning_incident || `Chambre ${room.number}`)}
                    >
                      <div className="room-number">{room.number}</div>
                      {task?.cleaning_type && (
                        <div className={`room-type-badge ${task.cleaning_type}`}>
                          {task.cleaning_type === 'blanc' ? 'BLANC' : 'RECOUCHE'}
                        </div>
                      )}
                      {assignedStaff && (
                        <div className="room-meta">
                          <span className="staff-name">{assignedStaff.name}</span>
                        </div>
                      )}
                      <div className="icons">
                        {task?.cleaning_lateCheckoutTime && <span title={`Late checkout: ${task.cleaning_lateCheckoutTime}`}>🕐</span>}
                        {task?.cleaning_freed && <span title="Libérée">🚪</span>}
                        {task?.cleaning_linenChange && <span title="Draps">🛏</span>}
                        {displayStatus === 'dnd' && <span title="Ne pas déranger">🚫</span>}
                        {task?.cleaning_incident && task.cleaning_incident.length > 0 && (
                          <span style={{ cursor: 'help', fontSize: '12px', position: 'relative' }} title={task.cleaning_incident}>
                            💬
                            <span style={{
                              position: 'absolute',
                              bottom: '100%',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              background: '#333',
                              color: '#fff',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              whiteSpace: 'nowrap',
                              zIndex: 1000,
                              display: 'none'
                            }} className="incident-tooltip">
                              {task.cleaning_incident}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Bottom Panel - stays open */}
        {selectedRooms.size > 0 && (
          <div className="bottom-panel">
            <div className="bottom-panel-header">
              <span>{selectedRooms.size} chambre(s) sélectionnée(s)</span>
              <Button variant="ghost" size="sm" onClick={clearSelection}>✕</Button>
            </div>
            
            <div className="bottom-panel-content">
              <div className="action-group">
                <label>Assigner à :</label>
                <div className="action-buttons" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {presentStaff.map(s => (
                    <Button 
                      key={s.id} 
                      size="sm"
                      onClick={() => handleAssign(s.id)}
                      disabled={!canModifySelected}
                    >
                      {s.name}
                    </Button>
                  ))}
                </div>
              </div>
              
              <div className="action-group">
                <label>Type :</label>
                <div className="action-buttons" style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" size="sm" onClick={() => handleTypeChange('blanc')} disabled={!canChangeTypeForSelected}>
                    Blanc
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleTypeChange('recouche')} disabled={!canChangeTypeForSelected}>
                    Recouche
                  </Button>
                </div>
              </div>

              <div className="action-group">
                <label>Statut :</label>
                <div className="action-buttons" style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" size="sm" onClick={handleFree} disabled={!canModifySelected} style={{ backgroundColor: '#FEF9C3' }}>
                    🚪 Libérer
                  </Button>
                  <Button variant="default" size="sm" onClick={() => setShowFinishConfirm(true)} disabled={!canModifySelected} style={{ backgroundColor: '#16A34A' }}>
                    ✅ Terminer
                  </Button>
                </div>
              </div>
              
              <div className="action-group">
                <label>Late Checkout :</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select 
                    value={lateCheckoutTime}
                    onChange={(e) => setLateCheckoutTime(e.target.value)}
                    className="filter-select"
                    disabled={!canChangeLateCheckoutForSelected}
                  >
                    <option value="">--</option>
                    <option value="12:00">12h</option>
                    <option value="13:00">13h</option>
                    <option value="14:00">14h</option>
                  </select>
                  <Button 
                    variant="secondary" 
                    size="sm" 
                    onClick={handleLateCheckout}
                    disabled={!lateCheckoutTime || !canChangeLateCheckoutForSelected}
                  >
                    Appliquer
                  </Button>
                </div>
              </div>
              
              <div className="action-group">
                <Button variant="destructive" size="sm" onClick={handleDelete} disabled={!canModifySelected}>
                  Supprimer
                </Button>
              </div>
            </div>
          </div>
        )}
        </div>
        )}
      </main>

      {/* Team Panel */}
      <Dialog open={showTeamPanel} onOpenChange={setShowTeamPanel}>
        <DialogContent style={{ maxWidth: 500 }}>
          <DialogHeader>
            <DialogTitle>Gestion de l'équipe</DialogTitle>
            <DialogDescription>Gérez les membres de l'équipe présents aujourd'hui</DialogDescription>
          </DialogHeader>
            
            <div className="staff-list" style={{ padding: 24 }}>
              {!Array.isArray(staff) || staff.length === 0 ? (
                <p style={{ color: '#6B7280', textAlign: 'center', padding: '20px' }}>
                  Ajoutez un membre pour commencer
                </p>
              ) : (
                staff.map(s => (
                  <div key={s.id} className="staff-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    {confirmDeleteId === s.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 8 }}>
                        <span>Supprimer <strong>{s.name}</strong> ?</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Button 
                            variant="secondary" 
                            size="sm"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Annuler
                          </Button>
                          <Button 
                            variant="destructive" 
                            size="sm"
                            onClick={async () => {
                              await deleteStaff(s.id);
                              setConfirmDeleteId(null);
                            }}
                          >
                            Confirmer
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <strong>{s.name}</strong>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <label className="toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input 
                              type="checkbox" 
                              checked={s.presentToday}
                              onChange={(e) => toggleStaffPresence(s.id, e.target.checked)}
                            />
                            <span>{s.presentToday ? 'Présente' : 'Absente'}</span>
                          </label>
                          <button 
                            onClick={() => setConfirmDeleteId(s.id)}
                            title="Supprimer"
                            style={{ 
                              background: 'none', 
                              border: 'none', 
                              color: '#6B7280', 
                              fontSize: 16, 
                              cursor: 'pointer',
                              padding: 4
                            }}
                            onMouseOver={(e) => e.target.style.color = '#DC2626'}
                            onMouseOut={(e) => e.target.style.color = '#6B7280'}
                          >
                            ✕
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
            
            {/* Add new staff */}
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <input 
                type="text"
                placeholder="Nouveau membre..."
                value={newStaffName}
                onChange={(e) => {
                  setNewStaffName(e.target.value);
                  if (staffNameError) setStaffNameError(false);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleAddStaff()}
                className="filter-select"
                style={{ 
                  flex: 1,
                  borderColor: staffNameError ? '#DC2626' : undefined
                }}
              />
              <Button 
                size="sm" 
                onClick={handleAddStaff}
                style={{ padding: '8px 16px' }}
              >
                Ajouter
              </Button>
            </div>
            
            <Button variant="secondary" onClick={() => setShowTeamPanel(false)} style={{ marginTop: 16 }}>
              Fermer
            </Button>
        </DialogContent>
      </Dialog>

      {/* Import Modal */}
      <Dialog open={showImportModal} onOpenChange={setShowImportModal}>
        <DialogContent style={{ maxWidth: 600 }}>
          <DialogHeader>
            <DialogTitle>Importer depuis Medialog</DialogTitle>
            <DialogDescription>Importez les chambres depuis un fichier Excel Medialog</DialogDescription>
          </DialogHeader>
            
            <div className="import-section">
              <label htmlFor="file-upload" style={{ 
                display: 'block', 
                padding: '24px', 
                border: '2px dashed #D1D5DB', 
                borderRadius: '8px', 
                textAlign: 'center', 
                cursor: 'pointer',
                marginBottom: 16
              }}>
                <p style={{ marginBottom: 8 }}>Cliquez pour sélectionner un fichier</p>
                <p style={{ fontSize: 12, color: '#6B7280' }}>.xlsx, .xlsm, .xls</p>
              </label>
              <input 
                id="file-upload"
                type="file" 
                accept=".xlsx,.xlsm,.xls"
                onChange={handleFileUpload}
                disabled={isImporting}
                style={{ display: 'none' }}
              />
              {isImporting && <p>Import en cours...</p>}
            </div>
            
            {dateWarning && (
              <div style={{ padding: '12px', background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 8, marginBottom: 16 }}>
                {dateWarning}
              </div>
            )}
            
            {importedTasks.length > 0 && (
              <div className="import-preview">
                <h3 style={{ marginBottom: 12 }}>{importedTasks.length} chambres détectées</h3>
                <div className="import-stats" style={{ display: 'flex', gap: 16, marginBottom: 16, padding: '12px', background: '#F9FAFB', borderRadius: 8 }}>
                  <span>🏠 Blanc: <strong>{importedTasks.filter(t => t.cleaning_type === 'blanc').length}</strong></span>
                  <span>🛏️ Recouche: <strong>{importedTasks.filter(t => t.cleaning_type === 'recouche').length}</strong></span>
                  <span>🧺 Linges: <strong>{importedTasks.filter(t => t.cleaning_linenChange).length}</strong></span>
                </div>
                
                {/* Date warning */}
                {importedFileDate && (() => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const fileDate = new Date(importedFileDate);
                  fileDate.setHours(0, 0, 0, 0);
                  const diffDays = Math.abs(Math.floor((today - fileDate) / (1000 * 60 * 60 * 24)));
                  
                  if (diffDays > 1) {
                    const dateStr = fileDate.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                    return (
                      <div style={{ 
                        marginBottom: 16, 
                        padding: '12px', 
                        background: '#FEF3C7', 
                        borderRadius: 8,
                        border: '1px solid #F59E0B',
                        color: '#92400E'
                      }}>
                        ⚠️ La date de cet export est le {dateStr}. Êtes-vous sûr d'importer le bon fichier ?
                      </div>
                    );
                  }
                  return null;
                })()}
                
                <Button onClick={confirmImport} style={{ width: '100%' }}>
                  Confirmer l'import
                </Button>
              </div>
            )}
            
            <Button variant="secondary" onClick={() => setShowImportModal(false)}>
              Annuler
            </Button>
        </DialogContent>
      </Dialog>

      {/* Finish Confirm */}
      <Dialog open={showFinishConfirm} onOpenChange={setShowFinishConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmer la fin</DialogTitle>
          </DialogHeader>
            <p style={{ color: '#DC2626', fontWeight: 600 }}>⚠️ Action irréversible</p>
            <p>Marquer {selectedRooms.size} chambre(s) comme terminée(s) ?</p>
            <p style={{ fontSize: 14, color: '#6B7280' }}>Cette action ne peut pas être annulée.</p>
            
            <DialogFooter>
              <Button variant="default" onClick={handleFinishFromReception} style={{ backgroundColor: '#16A34A' }}>
                ✅ Confirmer
              </Button>
              <Button variant="secondary" onClick={() => setShowFinishConfirm(false)}>
                Annuler
              </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Confirm */}
      <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réinitialiser</DialogTitle>
            <DialogDescription>Cette action réinitialise tous les statuts et assignations</DialogDescription>
          </DialogHeader>
            <p>Cette action va réinitialiser toutes les chambres (statuts et assignations).</p>
            <p>Êtes-vous sûr ?</p>
            
            <DialogFooter>
              <Button variant="destructive" onClick={handleResetAll} disabled={!canReset}>
                Confirmer
              </Button>
              <Button variant="secondary" onClick={() => setShowResetConfirm(false)}>
                Annuler
              </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================
// Reports Components
// ============================================

function ReportsList({ reports, onSelect }) {
  const { t, i18n } = useTranslation();
  
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(i18n.language === 'ro' ? 'ro-RO' : i18n.language === 'en' ? 'en-EN' : 'fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };
  
  if (reports.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
        <p>{t('noReports') || 'Aucun rapport'}</p>
      </div>
    );
  }
  
  return (
    <div className="reports-list">
      {reports.map(report => (
        <div
          key={report.id}
          onClick={() => onSelect(report)}
          style={{
            padding: '16px',
            borderBottom: '1px solid #E5E7EB',
            cursor: 'pointer',
            background: '#fff'
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {formatDate(report.date)}
          </div>
          <div style={{ fontSize: 14, color: '#6B7280' }}>
            {report.summary?.done || 0}/{report.summary?.total || 0} {t('done')} · {report.incidents?.length || 0} {t('incidents') || 'incident(s)'} · {report.summary?.postponed || 0} {t('postponed') || 'reportée(s)'}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportDetail({ report, onBack, tasks, staff }) {
  const { t, i18n } = useTranslation();
  
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(i18n.language === 'ro' ? 'ro-RO' : i18n.language === 'en' ? 'en-EN' : 'fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };
  
  const formatTime = (isoString) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleTimeString(i18n.language === 'ro' ? 'ro-RO' : i18n.language === 'en' ? 'en-EN' : 'fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  
  const handleReportPrint = () => {
    printReport(report);
  };
  
  if (!report) return null;
  
  return (
    <div className="report-detail" style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} style={{ marginBottom: 8 }}>
            ← {t('cancel')}
          </Button>
          <h2 style={{ fontSize: 24, fontWeight: 700 }}>{formatDate(report.date)}</h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="outline" onClick={handleReportPrint}>
            🖨️ {t('print') || 'Imprimer'}
          </Button>
        </div>
      </div>

      {/* Section 1 - Résumé global */}
      <div style={{ marginBottom: 24, background: '#F9FAFB', borderRadius: 12, padding: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t('summary') || 'Résumé global'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#16A34A' }}>{report.summary?.done || 0}/{report.summary?.total || 0}</div>
            <div style={{ fontSize: 14, color: '#6B7280' }}>{t('done') || 'Terminées'}</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#DC2626' }}>{report.summary?.dnd || 0}</div>
            <div style={{ fontSize: 14, color: '#6B7280' }}>{t('dnd') || 'DND'}</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#F59E0B' }}>{report.summary?.postponed || 0}</div>
            <div style={{ fontSize: 14, color: '#6B7280' }}>{t('postponed') || 'Reportées'}</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#6B7280' }}>{report.summary?.notDone || 0}</div>
            <div style={{ fontSize: 14, color: '#6B7280' }}>{t('notDone') || 'Non faites'}</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{formatTime(report.summary?.firstStartedAt)}</div>
            <div style={{ fontSize: 14, color: '#6B7280' }}>{t('firstStarted') || 'Première started'}</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{formatTime(report.summary?.lastCompletedAt)}</div>
            <div style={{ fontSize: 14, color: '#6B7280' }}>{t('lastCompleted') || 'Dernière terminée'}</div>
          </div>
        </div>
      </div>

      {/* Section 2 - Par femme de chambre */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t('byStaff') || 'Par femme de chambre'}</h3>
        <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#F9FAFB' }}>
              <tr>
                <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>{t('name') || 'Nom'}</th>
                <th style={{ padding: 12, textAlign: 'center', fontWeight: 600 }}>{t('roomsDone') || 'Chambres'}</th>
                <th style={{ padding: 12, textAlign: 'center', fontWeight: 600 }}>{t('blanc') || 'Blanc'}</th>
                <th style={{ padding: 12, textAlign: 'center', fontWeight: 600 }}>{t('recouche') || 'Recouche'}</th>
                <th style={{ padding: 12, textAlign: 'center', fontWeight: 600, color: '#F59E0B' }}>{t('postponed') || 'Reportées'}</th>
                <th style={{ padding: 12, textAlign: 'center', fontWeight: 600, color: '#DC2626' }}>{t('dnd') || 'DND'}</th>
                <th style={{ padding: 12, textAlign: 'center', fontWeight: 600 }}>{t('incidents') || 'Incidents'}</th>
                <th style={{ padding: 12, textAlign: 'center', fontWeight: 600 }}>Début</th>
                <th style={{ padding: 12, textAlign: 'center', fontWeight: 600 }}>Fin</th>
              </tr>
            </thead>
            <tbody>
              {report.byStaff?.map((staff, i) => (
                <tr key={i} style={{ borderTop: '1px solid #E5E7EB' }}>
                  <td style={{ padding: 12, fontWeight: 500 }}>{staff.name}</td>
                  <td style={{ padding: 12, textAlign: 'center' }}>{staff.done}</td>
                  <td style={{ padding: 12, textAlign: 'center' }}>{staff.blanc}</td>
                  <td style={{ padding: 12, textAlign: 'center' }}>{staff.recouche}</td>
                  <td style={{ padding: 12, textAlign: 'center', color: staff.postponed > 0 ? '#F59E0B' : '#6B7280' }}>{staff.postponed || 0}</td>
                  <td style={{ padding: 12, textAlign: 'center', color: staff.dnd > 0 ? '#DC2626' : '#6B7280' }}>{staff.dnd || 0}</td>
                  <td style={{ padding: 12, textAlign: 'center', color: staff.incidents > 0 ? '#DC2626' : '#6B7280' }}>{staff.incidents}</td>
                  <td style={{ padding: 12, textAlign: 'center' }}>{staff.shift_start || '-'}</td>
                  <td style={{ padding: 12, textAlign: 'center' }}>{staff.shift_end || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 3 - Par chambre */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Par chambre</h3>
        <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead style={{ background: '#F9FAFB' }}>
              <tr>
                <th style={{ padding: 10, textAlign: 'left', fontWeight: 600 }}>Ch.</th>
                <th style={{ padding: 10, textAlign: 'left', fontWeight: 600 }}>Assignée à</th>
                <th style={{ padding: 10, textAlign: 'center', fontWeight: 600 }}>Type</th>
                <th style={{ padding: 10, textAlign: 'center', fontWeight: 600 }}>Statut</th>
                <th style={{ padding: 10, textAlign: 'center', fontWeight: 600 }}>Incident</th>
                <th style={{ padding: 10, textAlign: 'center', fontWeight: 600 }}>Début</th>
                <th style={{ padding: 10, textAlign: 'center', fontWeight: 600 }}>Fin</th>
              </tr>
            </thead>
            <tbody>
              {report.tasksSnapshot?.sort((a, b) => {
                const numA = parseInt(a.roomNumber.toString().replace(/-.*/, '')) || 0;
                const numB = parseInt(b.roomNumber.toString().replace(/-.*/, '')) || 0;
                return numA - numB;
              }).map((task) => {
                const staffMember = report.byStaff?.find(s => s.name === task.cleaning_assignedTo);
                const displayStatus = task.cleaning_status === 'done' ? 'done' : 
                  (task.cleaning_status === 'ready' ? 'ready' :
                  (task.cleaning_status === 'in_progress' ? 'in_progress' : 
                  (task.cleaning_skip_reason === 'dnd' ? 'dnd' : 
                  (task.cleaning_skip_reason === 'postponed' ? 'postponed' : 
                  (task.cleaning_lateCheckoutTime ? 'late_checkout' : 'todo')))));
                let statusLabel = displayStatus;
                let statusColor = '#6B7280';
                if (displayStatus === 'done') { statusLabel = 'Terminée'; statusColor = '#16A34A'; }
                else if (displayStatus === 'ready') { statusLabel = 'Prête'; statusColor = '#16A34A'; }
                else if (displayStatus === 'in_progress') { statusLabel = 'En cours'; statusColor = '#F59E0B'; }
                else if (displayStatus === 'dnd') { statusLabel = 'DND'; statusColor = '#DC2626'; }
                else if (displayStatus === 'postponed') { statusLabel = 'Reportée'; statusColor = '#8B5CF6'; }
                else if (displayStatus === 'late_checkout') { statusLabel = 'Late'; statusColor = '#3B82F6'; }
                else { statusLabel = 'À faire'; }
                return (
                  <tr key={task.roomId} style={{ borderTop: '1px solid #E5E7EB' }}>
                    <td style={{ padding: 10, fontWeight: 600 }}>{task.roomNumber}</td>
                    <td style={{ padding: 10 }}>{task.cleaning_assignedTo || '-'}</td>
                    <td style={{ padding: 10, textAlign: 'center' }}>{task.cleaning_type === 'recouche' ? 'Recouche' : 'Blanc'}</td>
                    <td style={{ padding: 10, textAlign: 'center', color: statusColor, fontWeight: 500 }}>{statusLabel}</td>
                    <td style={{ padding: 10, textAlign: 'center', color: task.cleaning_incident ? '#DC2626' : '#6B7280' }}>
                      {task.cleaning_incident || '-'}
                    </td>
                    <td style={{ padding: 10, textAlign: 'center' }}>
                      {task.cleaning_startedAt ? (() => {
                        const d = task.cleaning_startedAt?.toDate ? task.cleaning_startedAt.toDate() : new Date(task.cleaning_startedAt);
                        return isNaN(d.getTime()) ? '-' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                      })() : '-'}
                    </td>
                    <td style={{ padding: 10, textAlign: 'center' }}>
                      {task.cleaning_completedAt ? (() => {
                        const d = task.cleaning_completedAt?.toDate ? task.cleaning_completedAt.toDate() : new Date(task.cleaning_completedAt);
                        return isNaN(d.getTime()) ? '-' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                      })() : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 4 - Incidents */}
      {report.incidents?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t('incidentsList') || 'Incidents'} ({report.incidents.length})</h3>
          <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
            {report.incidents.map((incident, i) => (
              <div key={i} style={{ padding: 12, borderBottom: i < report.incidents.length - 1 ? '1px solid #E5E7EB' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <span style={{ fontWeight: 600, minWidth: 40 }}>{incident.roomNumber}</span>
                  <span>{incident.text}</span>
                </div>
                <span style={{ color: '#6B7280', fontSize: 14 }}>{incident.assignedTo}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 4 - Chambres reportées */}
      {report.postponed?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t('postponedRooms') || 'Chambres reportées'} ({report.postponed.length})</h3>
          <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
            {report.postponed.map((room, i) => (
              <div key={i} style={{ padding: 12, borderBottom: i < report.postponed.length - 1 ? '1px solid #E5E7EB' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <span style={{ fontWeight: 600, minWidth: 40 }}>{room.roomNumber}</span>
                  <span>{room.type === 'recouche' ? '🛏️ Recouche' : '🧹 Blanc'}</span>
                </div>
                <span style={{ color: '#6B7280', fontSize: 14 }}>{room.assignedTo}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 5 - Chambres DND */}
      {report.dnd?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#DC2626' }}>{t('dnd')} ({report.dnd.length})</h3>
          <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
            {report.dnd.map((room, i) => (
              <div key={i} style={{ padding: 12, borderBottom: i < report.dnd.length - 1 ? '1px solid #E5E7EB' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <span style={{ fontWeight: 600, minWidth: 40 }}>{room.roomNumber}</span>
                  <span>{room.type === 'recouche' ? '🛏️ Recouche' : '🧹 Blanc'}</span>
                </div>
                <span style={{ color: '#6B7280', fontSize: 14 }}>{room.assignedTo}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Print Layout - Only visible when printing */}
      <div className="print-only" style={{ display: 'none' }}>
        <PrintLayout tasks={tasks} staff={staff} />
      </div>
    </div>
  );
}

// Print Layout Component
function PrintLayout({ tasks, staff }) {
  const today = new Date().toLocaleDateString('fr-FR', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  // Get present staff with tasks
  const presentStaff = staff.filter(s => s.presentToday);
  
  return (
    <div className="print-layout">
      {presentStaff.map(s => {
        const staffTasks = tasks
          .filter(t => t.cleaning_assignedTo === s.id && t.cleaning_status !== 'done' && t.cleaning_status !== 'ready')
          .sort((a, b) => {
            const numA = parseInt(a.roomNumber.toString().replace(/-.*/, '')) || 0;
            const numB = parseInt(b.roomNumber.toString().replace(/-.*/, '')) || 0;
            return numA - numB;
          });
        
        if (staffTasks.length === 0) return null;
        
        return (
          <div key={s.id} className="print-page" style={{ pageBreakAfter: 'always' }}>
            <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', fontSize: '12px' }}>
              {/* Header */}
              <div style={{ marginBottom: '20px', borderBottom: '2px solid black', paddingBottom: '10px' }}>
                <h1 style={{ fontSize: '18px', margin: 0 }}>Hôtel SUB — Gouvernante</h1>
                <p style={{ margin: '5px 0' }}>{today}</p>
                <p style={{ margin: '5px 0', fontWeight: 'bold' }}>{s.name}</p>
              </div>
              
              {/* Room list */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid black' }}>
                    <th style={{ textAlign: 'left', padding: '8px 4px' }}>Ch.</th>
                    <th style={{ textAlign: 'left', padding: '8px 4px' }}>Type</th>
                    <th style={{ textAlign: 'center', padding: '8px 4px' }}>Linge</th>
                    <th style={{ textAlign: 'center', padding: '8px 4px' }}>Late</th>
                    <th style={{ textAlign: 'left', padding: '8px 4px' }}>Heure</th>
                  </tr>
                </thead>
                <tbody>
                  {staffTasks.map(task => (
                    <tr key={task.roomId} style={{ borderBottom: '1px solid #ccc' }}>
                      <td style={{ padding: '8px 4px', fontWeight: 'bold' }}>{task.roomNumber}</td>
                      <td style={{ padding: '8px 4px' }}>{task.cleaning_type === 'recouche' ? 'Recouche' : 'À blanc'}</td>
                      <td style={{ textAlign: 'center', padding: '8px 4px' }}>{task.cleaning_linenChange ? '✓' : ''}</td>
                      <td style={{ textAlign: 'center', padding: '8px 4px' }}>{task.cleaning_lateCheckoutTime || ''}</td>
                      <td style={{ padding: '8px 4px', borderBottom: '1px dotted #999', minHeight: '20px' }}></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {/* Footer */}
              <div style={{ marginTop: '20px', borderTop: '1px solid black', paddingTop: '10px' }}>
                <strong>Total: {staffTasks.length} chambre(s)</strong>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
