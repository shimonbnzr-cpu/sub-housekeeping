import { useState, useEffect, useRef } from 'react';
import { TimePicker } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { ROOMS, FLOORS, CLEANING_TYPES, STATUS_COLORS } from '../data/rooms';
import { Card, CardContent } from '@/components/ui/card';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { 
  subscribeToActiveDate,
  getActiveDate,
  subscribeToTasks, 
  subscribeToStaff, 
  setTask, 
  updateTaskStatus, 
  assignTask,
  batchAssignTasks,
  batchUpdateTasksMessage,
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
  resetTaskToTodo,
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
  canModifyTask,
  retroactivelyGenerateAllMissingReports
} from '../services/firestore';
import { handlePrint, printSheets, printReport } from '../services/print';
import { parseMedialogFile } from '../services/import';
import { analytics } from '../services/analytics';
import StatisticsView from './StatisticsView';

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
  const [reportAuthor, setReportAuthor] = useState(() => localStorage.getItem('reportAuthor') || '');
  const [showReportAuthorDialog, setShowReportAuthorDialog] = useState(false);
  const [reportAuthorError, setReportAuthorError] = useState('');
  const [roomMessage, setRoomMessage] = useState('');
  const [currentDateKey, setCurrentDateKey] = useState(() => getActiveDate());
  const [retroactiveReportsAlert, setRetroactiveReportsAlert] = useState(null);
  const [inProgressRoomsForReport, setInProgressRoomsForReport] = useState([]);
  const [selectedInProgressRoomIds, setSelectedInProgressRoomIds] = useState({});
  const [lateCheckoutTime, setLateCheckoutTime] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState('planning'); // 'planning' | 'reports'
  const [showQRCode, setShowQRCode] = useState(false);
  const token = new URLSearchParams(window.location.search).get('token');
  const staffUrl = `${window.location.origin}/?mode=staff${token ? '&token=' + token : ''}`;
  const [selectedReport, setSelectedReport] = useState(null);
  const [reports, setReports] = useState([]);

  // Get active date formatted
  const activeDateObj = new Date(currentDateKey + 'T12:00:00');
  const dateStr = activeDateObj.toLocaleDateString('fr-FR', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  // URL Hash Router
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash === '#/reports') {
        setActiveTab('reports');
        setSelectedReport(null);
      } else if (hash === '#/statistics') {
        setActiveTab('statistics');
      } else {
        setActiveTab('planning');
        setSelectedReport(null);
      }
    };

    handleHashChange(); // Run on mount
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Subscribe to global active date
  useEffect(() => {
    const unsubActiveDate = subscribeToActiveDate((dateKey) => {
      console.log('[Date] Active date updated to:', dateKey);
      setCurrentDateKey(dateKey);
    });

    // Run one-time retroactive missing reports check on load
    const runRetroactiveCheck = async () => {
      console.log('[Retroactive-Reports] Starting background retroactive check...');
      const result = await retroactivelyGenerateAllMissingReports();
      if (result && result.count > 0) {
        console.log('[Retroactive-Reports] Found and generated missing reports:', result);
        setRetroactiveReportsAlert(result);
      }
    };
    runRetroactiveCheck();

    return () => unsubActiveDate();
  }, []);

  // Subscribe to realtime updates for the active date
  useEffect(() => {
    // Force French for Dashboard
    i18n.changeLanguage('fr');

    let unsubStaff;
    let unsubTasks;
    let unsubReports;
    
    const init = async () => {
      // Subscribe to staff
      unsubStaff = subscribeToStaff((staffList) => {
        if (staffList && Array.isArray(staffList)) {
          setStaff(staffList);
        }
      });

      // Subscribe to tasks for current active date
      unsubTasks = subscribeToTasks((taskList) => {
        setTasks(taskList);
        setLoading(false);
      });

      // Subscribe to reports list
      unsubReports = subscribeToReports((reportsList) => {
        setReports(reportsList);
      });
    };
    
    init();
    
    return () => {
      if (unsubTasks) unsubTasks();
      if (unsubStaff) unsubStaff();
      if (unsubReports) unsubReports();
    };
  }, [currentDateKey]);

  // Auto-generate daily report every day at 22:00 (Paris time) if not already generated
  useEffect(() => {
    const checkAndGenerateReport = async () => {
      const now = new Date();
      // Format current Paris time
      const parisHourStr = now.toLocaleTimeString('en-US', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false });
      const parisMinuteStr = now.toLocaleTimeString('en-US', { timeZone: 'Europe/Paris', minute: '2-digit' });
      const parisHour = parseInt(parisHourStr);
      const parisMinute = parseInt(parisMinuteStr);

      if (parisHour === 22 && parisMinute === 0) {
        const activeDate = getActiveDate();
        const alreadyGenerated = reports.some(r => r.id === activeDate);
        if (alreadyGenerated) {
          console.log('[Auto-Report] Report already exists for today, skipping auto-generation.');
          return;
        }
        
        console.log('[Auto-Report] Triggered at 22:00 Paris time | tasks:', tasks.length, '| staff:', staff.length);
        if (tasks.length > 0 && staff.length > 0) {
          try {
            const updatedTasks = [...tasks];
            const inProgress = tasks.filter(t => t.cleaning_status === 'in_progress');
            
            for (const task of inProgress) {
              await updateTaskStatus(task.id, 'done', { forceCompletedAtReport: true });
              const idx = updatedTasks.findIndex(t => t.id === task.id);
              if (idx !== -1) {
                updatedTasks[idx] = {
                  ...updatedTasks[idx],
                  cleaning_status: 'done',
                  cleaning_completedAt: new Date(),
                  forceCompletedAtReport: true
                };
              }
            }

            await generateAndSaveReport(updatedTasks, staff, 'Système (Auto-sauvegarde suite à oubli)', activeDate);
            console.log('[Auto-Report] Auto-generated report successfully');
          } catch (err) {
            console.error('[Auto-Report] Error in auto-generation:', err);
          }
        }
      }
    };

    const interval = setInterval(checkAndGenerateReport, 60000);
    return () => clearInterval(interval);
  }, [tasks, staff, reports]);

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
      const newSelection = new Set(selectedRooms);
      if (newSelection.has(room.id)) {
        newSelection.delete(room.id);
      } else {
        newSelection.add(room.id);
      }
      setSelectedRooms(newSelection);
    }
    isDraggingRef.current = false;
    setIsDragging(false);
  };

  const handleRoomMouseEnter = (room) => {
    if (isDragging) {
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

  const handleUnlock = async () => {
    if (selectedRooms.size === 0) return;
    
    for (const roomId of selectedRooms) {
      await resetTaskToTodo(roomId);
    }
    analytics.track('room_reset', { rooms_count: selectedRooms.size });
    setShowUnlockConfirm(false);
    clearSelection();
  };

  // Marquer comme terminé depuis la réception
  const handleFinishFromReception = async () => {
    if (selectedRooms.size === 0) return;
    
    for (const roomId of selectedRooms) {
      await ensureTaskExists(roomId);
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

  const handleApplyMessage = async () => {
    if (selectedRooms.size === 0) return;
    try {
      const ids = Array.from(selectedRooms);
      await batchUpdateTasksMessage(ids, roomMessage);
      setRoomMessage('');
      clearSelection();
      console.log('[Message] Message updated for selected rooms');
    } catch (err) {
      console.error('[Message] Error updating message:', err);
    }
  };

  const handleClearMessage = async () => {
    if (selectedRooms.size === 0) return;
    try {
      const ids = Array.from(selectedRooms);
      await batchUpdateTasksMessage(ids, null);
      setRoomMessage('');
      clearSelection();
      console.log('[Message] Message cleared for selected rooms');
    } catch (err) {
      console.error('[Message] Error clearing message:', err);
    }
  };

  const handleGenerateReport = () => {
    const inProgress = tasks.filter(t => t.cleaning_status === 'in_progress');
    setInProgressRoomsForReport(inProgress);
    const initialSelected = {};
    inProgress.forEach(t => {
      initialSelected[t.id] = true;
    });
    setSelectedInProgressRoomIds(initialSelected);
    setReportAuthorError('');
    setShowReportAuthorDialog(true);
  };

  const confirmGenerateReport = async () => {
    const authorName = reportAuthor.trim();
    if (!authorName) {
      setReportAuthorError('Veuillez renseigner votre prénom.');
      return;
    }
    setReportAuthorError('');
    localStorage.setItem('reportAuthor', authorName);
    
    setShowReportAuthorDialog(false);
    console.log('[Report] Generating report with', tasks.length, 'tasks,', staff.length, 'staff');
    try {
      const updatedTasks = [...tasks];
      const selectedIds = Object.keys(selectedInProgressRoomIds).filter(id => selectedInProgressRoomIds[id]);
      
      for (const taskId of selectedIds) {
        await updateTaskStatus(taskId, 'done', { forceCompletedAtReport: true });
        const idx = updatedTasks.findIndex(t => t.id === taskId);
        if (idx !== -1) {
          updatedTasks[idx] = {
            ...updatedTasks[idx],
            cleaning_status: 'done',
            cleaning_completedAt: new Date(),
            forceCompletedAtReport: true
          };
        }
      }

      await generateAndSaveReport(updatedTasks, staff, authorName);
      analytics.track('report_generated', { author: authorName, tasks_count: updatedTasks.length });
      console.log('[Report] Report generated successfully');
      alert('Rapport généré et sauvegardé.');
    } catch (err) {
      console.error('[Report] Error:', err);
      alert('Erreur lors de la génération: ' + err.message);
    }
  };

  const handleResetAll = async () => {
    await resetAllTasks(tasks);
    setShowResetConfirm(false);
  };

  const handleAutoAssign = async () => {
    // Get tasks that are not done, not ready, not in_progress, not skipped
    const tasksToAssign = tasks.filter(t => (t.cleaning_status === 'todo' ) && t.cleaning_skip_reason === null);
    await autoAssignTasks(tasksToAssign, staff);
    analytics.track('auto_assignment_triggered', {
      rooms_count: tasksToAssign.length,
      staff_count: staff.filter(s => s.isPresent).length
    });
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
    
    try {
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
      
      analytics.track('medialog_import_completed', {
        rooms_count: importedTasks.length,
        date: importedFileDate
      });
    } catch (error) {
      console.error('Import error:', error);
      alert('Erreur lors de l\'import: ' + error.message);
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
  const hasLockedSelected = Array.from(selectedRooms).some(roomId => {
    const task = getTaskForRoom(ROOMS.find(r => r.id === roomId));
    return task && (task.cleaning_status === 'done' || task.cleaning_status === 'in_progress');
  });

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
          <Button variant="outline" size="sm" onClick={() => handleGenerateReport()}>
            📊 Rapport
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowQRCode(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            {showQRCode ? '✕ Masquer' : '📱 QR Staff'}
          </Button>
          {showQRCode && (
            <div
              onClick={() => setShowQRCode(false)}
              style={{
                position: 'fixed', inset: 0,
                background: 'rgba(0,0,0,0.5)',
                zIndex: 9998,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: '#fff',
                  borderRadius: 16,
                  padding: '28px 24px',
                  maxWidth: 360,
                  width: 'calc(100% - 32px)',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                  textAlign: 'center',
                  zIndex: 9999,
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Interface femmes de chambre</div>
                <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>Scanner pour accéder à l'interface mobile</div>
                <div style={{ background: '#fff', padding: 16, borderRadius: 12, border: '1px solid #E5E7EB', display: 'inline-block', marginBottom: 14 }}>
                  <QRCodeSVG value={staffUrl} size={220} bgColor="#ffffff" fgColor="#111827" level="M" />
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace', wordBreak: 'break-all', background: '#F9FAFB', padding: '6px 10px', borderRadius: 6, border: '1px solid #E5E7EB' }}>{staffUrl}</div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', marginBottom: 16 }}>
        <a
          href="#/planning"
          style={{
            padding: '12px 24px',
            textDecoration: 'none',
            display: 'inline-block',
            background: activeTab === 'planning' ? '#3B82F6' : 'transparent',
            color: activeTab === 'planning' ? 'white' : '#6B7280',
            fontWeight: 600,
            cursor: 'pointer',
            borderRadius: '8px 8px 0 0',
            marginRight: 4
          }}
        >
          {t('allRooms')}
        </a>
        <a
          href="#/reports"
          style={{
            padding: '12px 24px',
            textDecoration: 'none',
            display: 'inline-block',
            background: activeTab === 'reports' ? '#3B82F6' : 'transparent',
            color: activeTab === 'reports' ? 'white' : '#6B7280',
            fontWeight: 600,
            cursor: 'pointer',
            borderRadius: '8px 8px 0 0',
            marginRight: 4
          }}
        >
          {t('reports')}
        </a>
        <a
          href="#/statistics"
          style={{
            padding: '12px 24px',
            textDecoration: 'none',
            display: 'inline-block',
            background: activeTab === 'statistics' ? '#3B82F6' : 'transparent',
            color: activeTab === 'statistics' ? 'white' : '#6B7280',
            fontWeight: 600,
            cursor: 'pointer',
            borderRadius: '8px 8px 0 0'
          }}
        >
          Statistiques 📊
        </a>
      </div>

      <main className="main" onClick={(e) => {
        if (e.target.closest('.bottom-panel') || e.target.closest('.btn') || e.target.closest('.modal')) return;
      }}>
        {retroactiveReportsAlert && (
          <div style={{
            background: '#EFF6FF',
            border: '1px solid #BFDBFE',
            borderRadius: 12,
            padding: '14px 20px',
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            color: '#1E40AF',
            fontSize: 14,
            fontWeight: 500,
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📝</span>
              <span>
                <strong>Rapports sauvegardés :</strong> {retroactiveReportsAlert.count} rapport(s) oublié(s) ont été automatiquement générés pour les dates suivantes : <strong>{retroactiveReportsAlert.dates.join(', ')}</strong>.
              </span>
            </div>
            <button 
              onClick={() => setRetroactiveReportsAlert(null)}
              style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 16, padding: '4px 8px', fontWeight: 'bold' }}
            >
              ✕
            </button>
          </div>
        )}
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
                  <TimePicker
                    value={s.shift_start ? dayjs(s.shift_start, 'HH:mm') : null}
                    onChange={(val) => updateStaffShift(s.id, val ? val.format('HH:mm') : null, s.shift_end)}
                    format="HH:mm"
                    size="small"
                    style={{ width: 70, fontSize: 11 }}
                    placeholder="Début"
                  />
                  <span>—</span>
                  <TimePicker
                    value={s.shift_end ? dayjs(s.shift_end, 'HH:mm') : null}
                    onChange={(val) => updateStaffShift(s.id, s.shift_start, val ? val.format('HH:mm') : null)}
                    format="HH:mm"
                    size="small"
                    style={{ width: 70, fontSize: 11 }}
                    placeholder="Fin"
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
                        {task?.cleaning_message && (
                          <span style={{ cursor: 'help', fontSize: '12px' }} title={`Consigne : ${task.cleaning_message}`}>
                            📝
                          </span>
                        )}
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
                <label>Message / Consigne :</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input 
                    type="text"
                    placeholder="Saisir un message..."
                    value={roomMessage}
                    onChange={(e) => setRoomMessage(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      border: '1px solid #D1D5DB',
                      borderRadius: 8,
                      fontSize: 13,
                      outline: 'none',
                      minWidth: 150
                    }}
                  />
                  <Button 
                    variant="secondary" 
                    size="sm" 
                    onClick={handleApplyMessage}
                    disabled={!roomMessage.trim()}
                  >
                    Ajouter
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleClearMessage}
                    title="Effacer le message"
                    style={{ padding: '0 8px', color: '#EF4444' }}
                  >
                    🗑️
                  </Button>
                </div>
              </div>
              
              <div className="action-group" style={{ display: 'flex', gap: 8 }}>
                {hasLockedSelected && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setShowUnlockConfirm(true)}
                    style={{ borderColor: '#EA580C', color: '#EA580C' }}
                  >
                    🔓 Remettre à faire
                  </Button>
                )}
                <Button variant="destructive" size="sm" onClick={handleDelete} disabled={!canModifySelected}>
                  Supprimer
                </Button>
              </div>
            </div>
          </div>
        )}
        </div>
        )}

        {/* Statistics Tab */}
        {activeTab === 'statistics' && (
          <StatisticsView tasks={tasks} staff={staff} reports={reports} />
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
                  
                  if (diffDays >= 1) {
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
        <DialogContent style={{ maxWidth: 440 }}>
          <DialogHeader>
            <DialogTitle>Terminer la journée</DialogTitle>
          </DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ color: '#374151', fontSize: 14, margin: 0 }}>
              Cette action va réinitialiser toutes les chambres (statuts et assignations) pour demain. Les DND et incidents seront effacés. Cette action est irréversible.
            </p>
            {(() => {
              const notDone = tasks.filter(t => t.cleaning_status !== 'done').length;
              return notDone > 0 ? (
                <p style={{ color: '#D97706', fontSize: 13, margin: 0, fontWeight: 500 }}>
                  ⚠️ {notDone} chambre(s) ne sont pas encore terminées.
                </p>
              ) : null;
            })()}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowResetConfirm(false)}>
              Annuler
            </Button>
            <Button
              style={{ backgroundColor: '#2563EB', color: '#fff' }}
              onClick={handleResetAll}
              disabled={!canReset}
            >
              Réinitialiser
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Author Dialog */}
      <Dialog open={showReportAuthorDialog} onOpenChange={setShowReportAuthorDialog}>
        <DialogContent style={{ maxWidth: 400 }}>
          <DialogHeader>
            <DialogTitle>Générer le rapport</DialogTitle>
          </DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 14, color: '#374151' }}>
              Votre nom :
              <input
                type="text"
                value={reportAuthor}
                onChange={(e) => setReportAuthor(e.target.value)}
                placeholder="Ex: Marie, Charles..."
                autoFocus
                style={{
                  width: '100%',
                  marginTop: 6,
                  padding: '10px 12px',
                  border: '1px solid #D1D5DB',
                  borderRadius: 8,
                  fontSize: 14,
                  boxSizing: 'border-box'
                }}
              />
            </label>
            {reportAuthorError && (
              <p style={{ color: '#EF4444', fontSize: 13, fontWeight: '500', margin: 0 }}>
                ⚠️ {reportAuthorError}
              </p>
            )}

            {inProgressRoomsForReport.length > 0 && (
              <div style={{ marginTop: 12, borderTop: '1px solid #E5E7EB', paddingTop: 12 }}>
                <p style={{ fontSize: 13, fontWeight: 'bold', color: '#EF4444', marginBottom: 8 }}>
                  ⚠️ Chambres toujours en cours :
                </p>
                <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {inProgressRoomsForReport.map(t => (
                    <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#4B5563', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={!!selectedInProgressRoomIds[t.id]}
                        onChange={(e) => {
                          setSelectedInProgressRoomIds(prev => ({
                            ...prev,
                            [t.id]: e.target.checked
                          }));
                        }}
                      />
                      Chambre {t.roomNumber} ({staff.find(s => s.id === t.cleaning_assignedTo)?.name || 'Sans nom'})
                    </label>
                  ))}
                </div>
                <p style={{ fontSize: 11, color: '#6B7280', marginTop: 8 }}>
                  Les chambres cochées seront marquées comme "terminées" et signalées dans les saisies suspectes (oublis de validation).
                </p>
              </div>
            )}
          </div>
          <DialogFooter style={{ marginTop: 8 }}>
            <Button variant="secondary" onClick={() => setShowReportAuthorDialog(false)}>
              Annuler
            </Button>
            <Button style={{ backgroundColor: '#2563EB', color: '#fff' }} onClick={confirmGenerateReport}>
              Générer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlock Confirm Dialog */}
      <Dialog open={showUnlockConfirm} onOpenChange={setShowUnlockConfirm}>
        <DialogContent style={{ maxWidth: 440 }}>
          <DialogHeader>
            <DialogTitle>Déverrouiller les chambres</DialogTitle>
          </DialogHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ color: '#374151', fontSize: 14, margin: 0 }}>
              Remettre les {selectedRooms.size} chambre(s) sélectionnée(s) à l'état "À faire" ?
            </p>
            <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
              Cela va annuler leur statut actuel (terminé ou en cours) et effacer les heures de début/fin de nettoyage, vous permettant de les réassigner ou de modifier leur type. Les femmes de chambre assignées actuelles seront conservées.
            </p>
          </div>
          <DialogFooter style={{ marginTop: 8 }}>
            <Button variant="secondary" onClick={() => setShowUnlockConfirm(false)}>
              Annuler
            </Button>
            <Button
              style={{ backgroundColor: '#EA580C', color: '#fff' }}
              onClick={handleUnlock}
            >
              🔓 Confirmer
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
  const [openMonths, setOpenMonths] = useState({});

  // Group reports by year/month
  const groupedReports = reports.reduce((acc, report) => {
    const date = new Date(report.date);
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-11
    const key = `${year}-${month}`;
    if (!acc[key]) {
      acc[key] = {
        year,
        month,
        label: date.toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : i18n.language === 'ro' ? 'ro-RO' : 'en-EN', { month: 'long', year: 'numeric' }),
        reports: []
      };
    }
    acc[key].reports.push(report);
    return acc;
  }, {});

  // Sort groups: most recent first, current month open by default
  const sortedGroups = Object.values(groupedReports).sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  // Initialize openMonths: current month open by default
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const initialOpen = {};
  sortedGroups.forEach(g => {
    initialOpen[`${g.year}-${g.month}`] = g.year === currentYear && g.month === currentMonth;
  });

  // Use state only on first render, then let user toggle
  const [localOpenMonths, setLocalOpenMonths] = useState(initialOpen);

  const toggleMonth = (key) => {
    setLocalOpenMonths(prev => ({ ...prev, [key]: !prev[key] }));
  };

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
      {sortedGroups.map(group => {
        const key = `${group.year}-${group.month}`;
        const isOpen = localOpenMonths[key] !== undefined ? localOpenMonths[key] : true;
        return (
          <div key={key} style={{ marginBottom: 8 }}>
            <div
              onClick={() => toggleMonth(key)}
              style={{
                padding: '12px 16px',
                background: '#F3F4F6',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontWeight: 600,
                fontSize: 14,
                textTransform: 'capitalize'
              }}
            >
              <span>{group.label}</span>
              <span style={{ color: '#9CA3AF' }}>{isOpen ? '▲' : '▼'}</span>
            </div>
            {isOpen && group.reports.map(report => (
              <div
                key={report.id}
                onClick={() => onSelect(report)}
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid #E5E7EB',
                  cursor: 'pointer',
                  background: '#fff'
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {formatDate(report.date)}
                </div>
                <div style={{ fontSize: 13, color: '#6B7280' }}>
                  {report.summary?.done || 0}/{report.summary?.total || 0} {t('done')} · {report.incidents?.length || 0} incident(s) · {report.summary?.postponed || 0} reportée(s)
                </div>
              </div>
            ))}
          </div>
        );
      })}
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
          {(report.generatedBy || report.generatedAt) && (
            <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
              {report.generatedBy ? `Par ${report.generatedBy}` : ''}
              {report.generatedBy && report.generatedAt ? ' · ' : ''}
              {report.generatedAt ? formatTime(report.generatedAt.seconds ? new Date(report.generatedAt.seconds * 1000).toISOString() : report.generatedAt) : ''}
            </div>
          )}
          {report.generatedBy && report.generatedBy.includes('Système') && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#FEF2F2',
              border: '1px solid #FCA5A5',
              color: '#991B1B',
              padding: '6px 10px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              marginTop: '8px'
            }}>
              <span>⚠️</span>
              <span>Ce rapport a été généré automatiquement suite à un oubli.</span>
            </div>
          )}
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
