import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CLEANING_TYPES } from '../data/rooms';
import { STAFF as INITIAL_STAFF, LANGUAGES } from '../data/staff';
import { subscribeToTasks, subscribeToStaff, updateTaskStatus, assignTask, setStaff as updateStaffInFirestore } from '../services/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export default function StaffView() {
  const { t, i18n } = useTranslation();
  const [tasks, setTasks] = useState([]);
  const [staff, setStaff] = useState(INITIAL_STAFF);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [loading, setLoading] = useState(true);
  const [incidentText, setIncidentText] = useState('');
  const [selectedTask, setSelectedTask] = useState(null);
  const [showTransfer, setShowTransfer] = useState(false);

  // Change language - update both i18n and Firestore
  const changeLanguage = async (lng) => {
    await i18n.changeLanguage(lng);
    localStorage.setItem('language', lng);
    // Update staff language in Firestore
    if (selectedStaff) {
      const staffMember = staff.find(s => s.id === selectedStaff);
      if (staffMember) {
        await updateStaffInFirestore({ ...staffMember, language: lng });
      }
    }
  };

  // Load language when staff member is selected
  useEffect(() => {
    if (selectedStaff && staff.length > 0) {
      const currentStaffMember = staff.find(s => s.id === selectedStaff);
      if (currentStaffMember?.language) {
        i18n.changeLanguage(currentStaffMember.language);
      }
    }
  }, [selectedStaff, staff, i18n]);

  // Load saved language on mount (before staff is selected)
  useEffect(() => {
    const savedLang = localStorage.getItem('language');
    if (savedLang && ['fr', 'en', 'ro'].includes(savedLang)) {
      i18n.changeLanguage(savedLang);
    }
  }, [i18n]);

  // Subscribe to realtime updates
  useEffect(() => {
    const unsubTasks = subscribeToTasks((taskList) => {
      setTasks(taskList);
      setLoading(false);
    });
    const unsubStaff = subscribeToStaff((staffList) => {
      if (staffList.length > 0) {
        setStaff(staffList);
      }
    });
    return () => {
      unsubTasks();
      unsubStaff();
    };
  }, []);

  // Filter tasks for selected staff
  const myTasks = tasks.filter(t => t.assignedTo === selectedStaff);

  // Sort: in_progress first, then freed, then todo, then dnd, then postponed, then done at bottom
  const sortedTasks = [...myTasks].sort((a, b) => {
    const statusOrder = { in_progress: 0, freed: 1, todo: 2, dnd: 3, postponed: 4, done: 5 };
    return (statusOrder[a.status] ?? 6) - (statusOrder[b.status] ?? 6);
  });

  const inProgressTasks = sortedTasks.filter(t => t.status === 'in_progress');
  const todoTasks = sortedTasks.filter(t => t.status === 'todo' || t.status === 'freed');
  const dndTasks = sortedTasks.filter(t => t.status === 'dnd');
  const postponedTasks = sortedTasks.filter(t => t.status === 'postponed');
  const doneTasks = sortedTasks.filter(t => t.status === 'done').sort((a, b) => a.roomNumber - b.roomNumber);

  // Available for transfer (not started by other staff)
  const availableTasks = tasks.filter(t => 
    t.assignedTo && 
    t.assignedTo !== selectedStaff && 
    t.status === 'todo'
  );

  const handleStart = async (task) => {
    await updateTaskStatus(task.roomId, 'in_progress');
  };

  const handleFinish = async (task) => {
    await updateTaskStatus(task.roomId, 'done', {
      incident: incidentText || null
    });
    setSelectedTask(null);
    setIncidentText('');
  };

  const handleDND = async (task) => {
    // Keep existing incident if it exists and is not "Ne pas déranger", otherwise just set DND
    const newIncident = task.incident && task.incident !== 'Ne pas déranger' 
      ? task.incident 
      : 'Ne pas déranger';
    await updateTaskStatus(task.roomId, 'dnd', {
      incident: newIncident
    });
  };

  const handlePostpone = async (task) => {
    await updateTaskStatus(task.roomId, 'postponed');
  };

  // Cancel DND and go back to todo
  const handleCancelDND = async (task) => {
    await updateTaskStatus(task.roomId, 'todo', {
      incident: task.incident === 'Ne pas déranger' ? null : task.incident
    });
  };

  // Cancel free and go back to todo
  const handleCancelFree = async (task) => {
    await updateTaskStatus(task.roomId, 'todo');
  };

  // Cancel postpone and go back to todo
  const handleCancelPostpone = async (task) => {
    await updateTaskStatus(task.roomId, 'todo');
  };

  const openFinishModal = (task) => {
    setSelectedTask(task);
    setIncidentText('');
  };

  // No staff selected yet
  if (!selectedStaff) {
    const presentStaff = staff.filter(s => s.presentToday);
    
    return (
      <div className="staff-view" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', padding: 24 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 400, width: '100%', margin: '0 auto' }}>
          <div className="staff-header" style={{ textAlign: 'center', marginBottom: 24 }}>
            <h1 style={{ fontSize: 28, marginBottom: 8 }}>🏨 {t('hotel')}</h1>
            <p style={{ fontSize: 18, color: '#6B7280' }}>{t('selectName')}</p>
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" style={{ width: '100%', justifyContent: 'space-between', padding: '12px 16px', fontSize: '16px' }}>
                {selectedStaff ? staff.find(s => s.id === selectedStaff)?.name : t('choose')}
                <span style={{ marginLeft: 8 }}>▼</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent style={{ width: '100%', maxHeight: '300px', overflowY: 'auto' }}>
              {presentStaff.map(s => (
                <DropdownMenuItem 
                  key={s.id} 
                  onClick={() => setSelectedStaff(s.id)}
                  style={{ padding: '12px 16px', fontSize: '16px', cursor: 'pointer' }}
                >
                  {s.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }

  const currentStaff = staff.find(s => s.id === selectedStaff);

  if (loading) {
    return <div className="staff-view"><p>Chargement...</p></div>;
  }

  return (
    <div className="staff-view">
      <div className="staff-header">
        <h1>🏨 {t('hotel')}</h1>
        <p>{t('hello')} {currentStaff?.name} 👋</p>
        <p style={{ color: '#6B7280', fontSize: 14 }}>
          {todoTasks.length} {t('toDo')} • {inProgressTasks.length} {t('inProgress')}
        </p>
        
        {/* Language selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              🌐 {LANGUAGES[currentStaff?.language] || 'Français'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {Object.entries(LANGUAGES).map(([code, label]) => (
              <DropdownMenuItem 
                key={code} 
                onClick={() => changeLanguage(code)}
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {myTasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
          <p>{t('noRooms')}</p>
        </div>
      ) : (
        <div className="task-list">
          {/* Progress bar */}
          {(() => {
            const doneCount = doneTasks.length;
            const totalCount = myTasks.length;
            const progressPercent = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;
            return (
              <div style={{ marginBottom: 16 }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  marginBottom: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#374151'
                }}>
                  <span>{doneCount}/{totalCount} {t('progress')}</span>
                  <span>{Math.round(progressPercent)}%</span>
                </div>
                <div style={{ 
                  width: '100%', 
                  height: 8, 
                  background: '#E5E7EB', 
                  borderRadius: 4,
                  overflow: 'hidden'
                }}>
                  <div style={{ 
                    width: `${progressPercent}%`, 
                    height: '100%', 
                    background: '#16A34A',
                    borderRadius: 4,
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </div>
            );
          })()}

          {/* En cours first */}
          {inProgressTasks.map(task => (
            <div key={task.id} className="task-card" style={{ background: '#FFEDD5' }}>
              <div className="task-card-header" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="task-number">{task.roomNumber}</span>
                
                {/* Type badge absolutely centered */}
                <span style={{ 
                  position: 'absolute', 
                  left: '50%', 
                  transform: 'translateX(-50%)',
                  padding: '6px 12px', 
                  borderRadius: '6px', 
                  fontWeight: 600, 
                  fontSize: '12px',
                  background: task.type === 'recouche' ? '#8B5CF6' : '#3B82F6',
                  color: 'white'
                }}>
                  {task.type === 'recouche' ? `🛏️ ${t('recouche')}` : `🧹 ${t('blanc')}`}
                </span>
                
                {task.status && (
                  <span className={`task-type ${task.status === 'in_progress' ? 'in-progress' : task.status}`}>
                    {task.status === 'in_progress' ? t('inProgress') : task.status === 'freed' ? t('freed') : ''}
                  </span>
                )}
              </div>
              
              <div className="task-icons">
                {task.lateCheckoutTime && <span>🕐 {task.lateCheckoutTime}</span>}
                {task.linenChange && <span>🛏</span>}
              </div>
              
              {task.incident && (
                <div className="task-incident">
                  ⚠️ {task.incident}
                </div>
              )}
              
              <div className="task-actions">
                <Button variant="default" style={{ backgroundColor: "#16A34A" }} onClick={() => openFinishModal(task)}>
                  ✅ {t('finish')}
                </Button>
              </div>
            </div>
          ))}

          {/* À faire */}
          {todoTasks.map(task => (
            <div key={task.id} className="task-card" style={task.status === 'freed' ? { background: '#FEF9C3' } : {}}>
              <div className="task-card-header" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="task-number">{task.roomNumber}</span>
                
                {/* Type badge absolutely centered */}
                <span style={{ 
                  position: 'absolute', 
                  left: '50%', 
                  transform: 'translateX(-50%)',
                  padding: '6px 12px', 
                  borderRadius: '6px', 
                  fontWeight: 600, 
                  fontSize: '12px',
                  background: task.type === 'recouche' ? '#8B5CF6' : '#3B82F6',
                  color: 'white'
                }}>
                  {task.type === 'recouche' ? `🛏️ ${t('recouche')}` : `🧹 ${t('blanc')}`}
                </span>
                
                {task.status === 'freed' && (
                  <span className={`task-type ${task.type}`}>
                    🚪
                  </span>
                )}
              </div>
              
              <div className="task-icons">
                {task.lateCheckoutTime && <span>🕐 {task.lateCheckoutTime}</span>}
                {task.linenChange && <span>🛏</span>}
                {task.status === 'freed' && <span>🚪 {t('freed')}</span>}
              </div>
              
              {task.incident && (
                <div className="task-incident">
                  ⚠️ {task.incident}
                </div>
              )}
              
              <div className="task-actions">
                <Button onClick={() => handleStart(task)}>
                  ▶️ {t('start')}
                </Button>
                {task.status === 'freed' && (
                  <Button variant="secondary" size="sm" onClick={() => handleCancelFree(task)}>
                    {t('cancel')}
                  </Button>
                )}
                {task.status !== 'freed' && (
                  <>
                    <Button variant="destructive" onClick={() => handleDND(task)}>
                      🚫 {t('dnd')}
                    </Button>
                    <Button variant="secondary" onClick={() => handlePostpone(task)}>
                      📅 {t('postpone')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}

          {/* DND - can be cancelled */}
          {dndTasks.length > 0 && (
            <div className="task-dnd-section">
              <div className="task-dnd-summary">
                🚫 {t('dnd')} ({dndTasks.length})
              </div>
              {dndTasks.map(task => (
                <div key={task.id} className="task-card" style={{ background: '#FEF9C3' }}>
                  <div className="task-card-header" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="task-number">{task.roomNumber}</span>
                    
                    {/* Type badge absolutely centered */}
                    <span style={{ 
                      position: 'absolute', 
                      left: '50%', 
                      transform: 'translateX(-50%)',
                      padding: '6px 12px', 
                      borderRadius: '6px', 
                      fontWeight: 600, 
                      fontSize: '12px',
                      background: task.type === 'recouche' ? '#8B5CF6' : '#3B82F6',
                      color: 'white'
                    }}>
                      {task.type === 'recouche' ? `🛏️ ${t('recouche')}` : `🧹 ${t('blanc')}`}
                    </span>
                    
                    <span className="task-type dnd">🚫</span>
                  </div>
                  
                  <div className="task-icons">
                    {task.lateCheckoutTime && <span>🕐 {task.lateCheckoutTime}</span>}
                    {task.linenChange && <span>🛏</span>}
                  </div>
                  
                  {task.incident && task.incident !== 'Ne pas déranger' && (
                    <div className="task-incident">
                      ⚠️ {task.incident}
                    </div>
                  )}
                  
                  <div className="task-actions">
                    <Button variant="secondary" size="sm" onClick={() => handleCancelDND(task)}>
                      🚪 {t('unlock')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Postponed - can be resumed */}
          {postponedTasks.length > 0 && (
            <div className="task-postponed-section">
              <div className="task-postponed-summary">
                📅 {t('postponed')} ({postponedTasks.length})
              </div>
              {postponedTasks.map(task => (
                <div key={task.id} className="task-card" style={{ background: '#E5E7EB' }}>
                  <div className="task-card-header" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="task-number">{task.roomNumber}</span>
                    
                    {/* Type badge absolutely centered */}
                    <span style={{ 
                      position: 'absolute', 
                      left: '50%', 
                      transform: 'translateX(-50%)',
                      padding: '6px 12px', 
                      borderRadius: '6px', 
                      fontWeight: 600, 
                      fontSize: '12px',
                      background: task.type === 'recouche' ? '#8B5CF6' : '#3B82F6',
                      color: 'white'
                    }}>
                      {task.type === 'recouche' ? `🛏️ ${t('recouche')}` : `🧹 ${t('blanc')}`}
                    </span>
                    
                    <span className="task-type postponed">📅</span>
                  </div>
                  
                  <div className="task-icons">
                    {task.lateCheckoutTime && <span>🕐 {task.lateCheckoutTime}</span>}
                    {task.linenChange && <span>🛏</span>}
                  </div>
                  
                  {task.incident && (
                    <div className="task-incident">
                      ⚠️ {task.incident}
                    </div>
                  )}
                  
                  <div className="task-actions">
                    <Button variant="secondary" size="sm" onClick={() => handleCancelPostpone(task)}>
                      ▶️ {t('resume')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Done tasks - integrated in the main flow */}
          {doneTasks.map(task => (
            <div key={task.id} className="task-card" style={{ background: '#F0FDF4' }}>
              <div className="task-card-header" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="task-number">{task.roomNumber}</span>
                
                {/* Type badge absolutely centered */}
                <span style={{ 
                  position: 'absolute', 
                  left: '50%', 
                  transform: 'translateX(-50%)',
                  padding: '6px 12px', 
                  borderRadius: '6px', 
                  fontWeight: 600, 
                  fontSize: '12px',
                  background: task.type === 'recouche' ? '#8B5CF6' : '#3B82F6',
                  color: 'white'
                }}>
                  {task.type === 'recouche' ? `🛏️ ${t('recouche')}` : `🧹 ${t('blanc')}`}
                </span>
                
                <span style={{ 
                  color: '#16A34A', 
                  fontWeight: 600, 
                  fontSize: '12px'
                }}>
                  {t('done')}
                </span>
              </div>
              
              <div className="task-icons">
                {task.lateCheckoutTime && <span>🕐 {task.lateCheckoutTime}</span>}
                {task.linenChange && <span>🛏</span>}
              </div>
              
              {task.incident && (
                <div className="task-incident">
                  ⚠️ {task.incident}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Transfer button - full width */}
      {availableTasks.length > 0 && (
        <Button 
          variant="secondary"
          onClick={() => setShowTransfer(!showTransfer)}
          style={{ width: '100%', marginBottom: 16 }}
        >
          + {t('addRooms')} ({availableTasks.length})
        </Button>
      )}

      {/* Transfer panel */}
      {showTransfer && (
        <div className="transfer-panel">
          <h3>{t('availableRooms')}</h3>
          <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
            {t('tapToTake')}
          </p>
          <div className="transfer-list">
            {availableTasks.map(task => {
              const assignedStaff = staff.find(s => s.id === task.assignedTo);
              return (
                <div 
                  key={task.id} 
                  className="transfer-item"
                  onClick={() => {
                    assignTask(task.roomId, selectedStaff);
                    setShowTransfer(false);
                  }}
                >
                  <span className="transfer-room">{task.roomNumber}</span>
                  <span className={`badge badge-${task.type}`}>
                    {CLEANING_TYPES[task.type] || t('blanc')}
                  </span>
                  <span className="transfer-from">de {assignedStaff?.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Change staff */}
      <div className="staff-footer">
        <Button 
          variant="secondary"
          onClick={() => setSelectedStaff('')}
        >
          {t('changeName')}
        </Button>
      </div>

      {/* Finish modal */}
      <Dialog open={!!selectedTask} onOpenChange={() => setSelectedTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('finishRoom')} {selectedTask?.roomNumber}</DialogTitle>
              <DialogDescription>{t('incident')}</DialogDescription>
          </DialogHeader>
            
            <textarea
              className="incident-input"
              placeholder="Un incident à signaler ? (optionnel)"
              value={incidentText}
              onChange={(e) => setIncidentText(e.target.value)}
              style={{ width: '100%', minHeight: 100, padding: 10, marginTop: 10 }}
            />
            
            <DialogFooter>
              <Button variant="default" style={{ backgroundColor: "#16A34A" }} onClick={() => handleFinish(selectedTask)}>
                ✅ {t('confirm')}
              </Button>
              <Button variant="secondary" onClick={() => setSelectedTask(null)}>
                {t('cancel')}
              </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
