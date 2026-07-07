import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid 
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// Helper to convert Firestore timestamp or ISO string to Date object
const parseDate = (val) => {
  if (!val) return null;
  if (val.seconds) return new Date(val.seconds * 1000);
  if (val.toDate) return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

// Helper to parse time string "HH:MM" to minutes
const parseTime = (timeStr) => {
  if (!timeStr) return null;
  const cleanStr = timeStr.replace('h', ':').trim();
  const parts = cleanStr.split(':');
  if (parts.length < 2) return null;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
};

// Helper to parse late checkout time and return a Date object
const parseLateCheckout = (timeStr, baseDateStr) => {
  if (!timeStr) return null;
  const cleanStr = timeStr.replace('h', ':').trim();
  const parts = cleanStr.split(':');
  if (parts.length === 0) return null;
  const hour = parseInt(parts[0], 10);
  const minute = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  if (isNaN(hour)) return null;
  
  const d = new Date(baseDateStr + 'T00:00:00');
  d.setHours(hour, minute, 0, 0);
  return d;
};

// Determines checkout release time for a task (1. freedAt, 2. lateCheckout, 3. default to 11:00)
const getReleaseTime = (t, baseDateStr) => {
  const freedAt = parseDate(t.cleaning_freedAt);
  if (freedAt) return freedAt;
  
  if (t.cleaning_lateCheckoutTime) {
    const lateTime = parseLateCheckout(t.cleaning_lateCheckoutTime, baseDateStr);
    if (lateTime) return lateTime;
  }
  
  const d = new Date(baseDateStr + 'T00:00:00');
  d.setHours(11, 0, 0, 0);
  return d;
};

// Calculate shift duration in hours
const getShiftHours = (startStr, endStr) => {
  const start = parseTime(startStr);
  const end = parseTime(endStr);
  if (start === null || end === null || end <= start) return 0;
  return (end - start) / 60;
};

// Compiles today's in-memory active tasks into a daily summary layout matching the reports collection schema
const compileTodaySummary = (tasks, staff) => {
  const todayStr = new Date().toLocaleDateString('fr-CA');
  
  // Include present staff or anyone assigned to tasks today
  const activeStaff = staff.filter(s => s.presentToday || tasks.some(t => t.cleaning_assignedTo === s.id));
  
  const byStaff = activeStaff.map(s => {
    const staffTasks = tasks.filter(t => t.cleaning_assignedTo === s.id);
    const staffDone = staffTasks.filter(t => t.cleaning_status === 'done');
    const staffBlanc = staffDone.filter(t => t.cleaning_type === 'blanc');
    const staffRecouche = staffDone.filter(t => t.cleaning_type === 'recouche');
    const staffIncidents = staffTasks.filter(t => t.cleaning_incident && t.cleaning_incident !== 'Ne pas déranger');

    return {
      id: s.id,
      name: s.name,
      done: staffDone.length,
      blanc: staffBlanc.length,
      recouche: staffRecouche.length,
      incidents: staffIncidents.length,
      postponed: tasks.filter(t => t.cleaning_assignedTo === s.id && t.cleaning_skip_reason === 'postponed').length,
      dnd: tasks.filter(t => t.cleaning_assignedTo === s.id && t.cleaning_skip_reason === 'dnd').length,
      shift_start: s.shift_start || null,
      shift_end: s.shift_end || null
    };
  });

  const doneTasks = tasks.filter(t => t.cleaning_status === 'done');
  const dndTasks = tasks.filter(t => t.cleaning_skip_reason === 'dnd');
  const postponedTasks = tasks.filter(t => t.cleaning_skip_reason === 'postponed');

  return {
    date: todayStr,
    summary: {
      total: tasks.length,
      done: doneTasks.length,
      inProgress: tasks.filter(t => t.cleaning_status === 'in_progress').length,
      dnd: dndTasks.length,
      postponed: postponedTasks.length,
      notDone: tasks.filter(t => t.cleaning_status === 'todo' && t.cleaning_skip_reason === null).length
    },
    byStaff,
    tasksSnapshot: tasks, // Keep complete task snapshots for real-time calculations
    isToday: true
  };
};

// Compiles a task list (snapshot) by grouping beds into single physical room units and classifying Classic vs Dorm
const compilePhysicalSummary = (s, staff) => {
  const snapshot = s.tasksSnapshot || [];
  
  // Group tasks by their physical room base number
  const roomsMap = {};
  snapshot.forEach(t => {
    const roomNumberStr = String(t.roomNumber);
    const roomBase = roomNumberStr.split('-')[0];
    
    if (!roomsMap[roomBase]) {
      roomsMap[roomBase] = {
        roomBase,
        tasks: []
      };
    }
    roomsMap[roomBase].tasks.push(t);
  });

  // Calculate state, assignee, type, and durations for each physical room
  const physicalRooms = Object.values(roomsMap).map(r => {
    const doneTasks = r.tasks.filter(t => t.cleaning_status === 'done');
    const assignedTasks = r.tasks.filter(t => t.cleaning_assignedTo);
    
    const isDone = doneTasks.length > 0;
    const isInProgress = r.tasks.some(t => t.cleaning_status === 'in_progress');
    const isDnd = r.tasks.some(t => t.cleaning_skip_reason === 'dnd');
    const isPostponed = r.tasks.some(t => t.cleaning_skip_reason === 'postponed');
    const forceCompletedAtReport = r.tasks.some(t => t.forceCompletedAtReport === true);

    const assignedStaffId = assignedTasks.length > 0 ? assignedTasks[0].cleaning_assignedTo : null;
    const type = r.tasks.length > 0 ? r.tasks[0].cleaning_type : 'recouche';
    const incidentText = r.tasks.find(t => t.cleaning_incident && t.cleaning_incident !== 'Ne pas déranger')?.cleaning_incident || null;

    // Check if it is a dorm room
    const isDorm = r.tasks.some(t => String(t.roomNumber).includes('-'));
    const bedsCount = isDorm ? r.tasks.length : 1;
    const bedsDoneCount = isDorm ? doneTasks.length : (isDone ? 1 : 0);

    // Room start time is the earliest start of any task in the room
    const startTimes = r.tasks.map(t => parseDate(t.cleaning_startedAt)).filter(d => d !== null);
    // Room end time is the latest completion of any task in the room
    const endTimes = r.tasks.map(t => parseDate(t.cleaning_completedAt)).filter(d => d !== null);
    
    const firstStartedAt = startTimes.length > 0 ? new Date(Math.min(...startTimes)) : null;
    const lastCompletedAt = endTimes.length > 0 ? new Date(Math.max(...endTimes)) : null;
    
    const durationMin = firstStartedAt && lastCompletedAt && lastCompletedAt > firstStartedAt
      ? (lastCompletedAt - firstStartedAt) / (1000 * 60)
      : null;

    return {
      roomBase: r.roomBase,
      isDone,
      isInProgress,
      isDnd,
      isPostponed,
      forceCompletedAtReport,
      assignedStaffId,
      type,
      incidentText,
      firstStartedAt,
      lastCompletedAt,
      durationMin,
      isDorm,
      bedsCount,
      bedsDoneCount
    };
  });

  // Re-calculate the staff metrics based on unique physical rooms cleaned and direct bed task types
  const presentStaffIds = s.byStaff 
    ? s.byStaff.map(st => st.id) 
    : Array.from(new Set(physicalRooms.map(r => r.assignedStaffId).filter(id => id !== null)));
  
  const byStaff = presentStaffIds.map(staffId => {
    const staffMember = staff.find(st => st.id === staffId);
    
    // Find all completed tasks directly for accurate bed counts (fixing (0B/0R) bug)
    const staffDoneTasks = snapshot.filter(t => t.cleaning_assignedTo === staffId && t.cleaning_status === 'done');
    
    const classicBlanc = staffDoneTasks.filter(t => !String(t.roomNumber).includes('-') && t.cleaning_type === 'blanc').length;
    const classicRecouche = staffDoneTasks.filter(t => !String(t.roomNumber).includes('-') && t.cleaning_type === 'recouche').length;
    const classicDone = classicBlanc + classicRecouche;

    const bedsBlanc = staffDoneTasks.filter(t => String(t.roomNumber).includes('-') && t.cleaning_type === 'blanc').length;
    const bedsRecouche = staffDoneTasks.filter(t => String(t.roomNumber).includes('-') && t.cleaning_type === 'recouche').length;
    const bedsDone = bedsBlanc + bedsRecouche;

    // Physical dorms counts
    const staffRooms = physicalRooms.filter(r => r.assignedStaffId === staffId);
    const dormsDone = staffRooms.filter(r => r.isDone && r.isDorm);
    const dormsBlanc = dormsDone.filter(r => r.type === 'blanc').length;
    const dormsRecouche = dormsDone.filter(r => r.type === 'recouche').length;

    const incidentRooms = staffRooms.filter(r => r.incidentText);
    const postponedRooms = staffRooms.filter(r => r.isPostponed);
    const dndRooms = staffRooms.filter(r => r.isDnd);

    const bsOriginal = s.byStaff?.find(st => st.id === staffId);
    const shift_start = bsOriginal ? bsOriginal.shift_start : (staffMember?.shift_start || null);
    const shift_end = bsOriginal ? bsOriginal.shift_end : (staffMember?.shift_end || null);

    return {
      id: staffId,
      name: staffMember?.name || bsOriginal?.name || 'Inconnu',
      done: classicDone + dormsDone.length,
      
      // Granular physical counts
      classicDone,
      classicBlanc,
      classicRecouche,
      
      dormsDone: dormsDone.length,
      dormsBlanc: dormsBlanc.length,
      dormsRecouche: dormsRecouche.length,

      // Bed counts
      bedsDone,
      bedsBlanc,
      bedsRecouche,

      incidents: incidentRooms.length,
      postponed: postponedRooms.length,
      dnd: dndRooms.length,
      shift_start,
      shift_end
    };
  });

  const doneCount = physicalRooms.filter(r => r.isDone).length;
  const inProgressCount = physicalRooms.filter(r => r.isInProgress && !r.isDone).length;
  const dndCount = physicalRooms.filter(r => r.isDnd && !r.isDone).length;
  const postponedCount = physicalRooms.filter(r => r.isPostponed && !r.isDone).length;

  return {
    date: s.date,
    summary: {
      total: physicalRooms.length,
      done: doneCount,
      inProgress: inProgressCount,
      dnd: dndCount,
      postponed: postponedCount,
      notDone: physicalRooms.filter(r => !r.isDone && !r.isInProgress && !r.isDnd && !r.isPostponed).length
    },
    byStaff,
    physicalRooms,
    isToday: !!s.isToday
  };
};

export default function StatisticsView({ tasks = [], staff = [], reports = [] }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState('week'); // 'today' | 'week' | 'month' | 'year' | 'custom' | 'all'
  
  // Lock state with sessionStorage persistence
  const [password, setPassword] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(() => sessionStorage.getItem('stats_unlocked') === 'true');
  const [passwordError, setPasswordError] = useState('');

  // Date range picker states
  const [customStartDate, setCustomStartDate] = useState(() => {
    // Default to Monday of current week
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    return monday.toLocaleDateString('fr-CA'); // YYYY-MM-DD
  });

  const [customEndDate, setCustomEndDate] = useState(() => {
    return new Date().toLocaleDateString('fr-CA'); // YYYY-MM-DD
  });

  const handleUnlockSubmit = (e) => {
    e.preventDefault();
    if (password === '120120') {
      sessionStorage.setItem('stats_unlocked', 'true');
      setIsUnlocked(true);
      setPasswordError('');
    } else {
      setPasswordError('Code d\'accès incorrect');
    }
  };

  // --- Core Calculations Engine ---
  const stats = useMemo(() => {
    // Helper to check if a date falls within the selected period
    const checkInRange = (dateStr) => {
      const now = new Date();
      const todayStr = now.toLocaleDateString('fr-CA'); // YYYY-MM-DD
      
      if (period === 'today') return dateStr === todayStr;

      if (period === 'week') {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(now.setDate(diff));
        monday.setHours(0, 0, 0, 0);
        
        const itemDate = new Date(dateStr + 'T00:00:00');
        return itemDate >= monday;
      }
      
      if (period === 'month') {
        const itemDate = new Date(dateStr + 'T00:00:00');
        return itemDate.getFullYear() === now.getFullYear() && itemDate.getMonth() === now.getMonth();
      }
      
      if (period === 'year') {
        const itemDate = new Date(dateStr + 'T00:00:00');
        return itemDate.getFullYear() === now.getFullYear();
      }

      if (period === 'custom') {
        return dateStr >= customStartDate && dateStr <= customEndDate;
      }
      
      return true; // 'all'
    };

    // Compile today's live summary and merge with historical reports
    const todaySummary = compileTodaySummary(tasks, staff);
    const combinedSummaries = [
      ...reports.filter(r => r.date !== todaySummary.date),
      todaySummary
    ];

    // Process all summaries to group task listings by physical room unit
    const processedSummaries = combinedSummaries.map(s => {
      if (s.tasksSnapshot && s.tasksSnapshot.length > 0) {
        return compilePhysicalSummary(s, staff);
      }
      return s;
    });

    // Filter summaries in the active date period
    const filteredSummaries = processedSummaries.filter(s => checkInRange(s.date));

    // Extract and parse all completed physical rooms details across the period
    const completedClassics = [];
    const completedDorms = [];
    const suspectValidations = [];
    
    // Limits to filter out non-real validation duration data
    const MIN_LIMIT_MIN = 2;
    const MAX_LIMIT_MIN = 60;

    filteredSummaries.forEach(s => {
      const rooms = s.physicalRooms || [];
      rooms.forEach(r => {
        if (r.isDone) {
          const durationMin = r.durationMin;
          const isOutlier = durationMin !== null && (durationMin < MIN_LIMIT_MIN || durationMin > MAX_LIMIT_MIN);
          const isForceCompleted = r.forceCompletedAtReport === true;

          // Suspect validation log (Alerts)
          if (isOutlier || isForceCompleted) {
            const staffName = staff.find(st => st.id === r.assignedStaffId)?.name || 'Inconnu';
            let reason = '';
            if (isForceCompleted) {
              reason = 'Oubli de validation (Forcé à la clôture)';
            } else if (durationMin < MIN_LIMIT_MIN) {
              reason = 'Trop rapide (< 2 min)';
            } else {
              reason = 'Oubli de validation (> 60 min)';
            }

            suspectValidations.push({
              date: s.date,
              roomNumber: r.roomBase,
              staffName,
              durationMin: durationMin !== null ? Math.round(durationMin * 10) / 10 : '--',
              time: r.lastCompletedAt ? r.lastCompletedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'Clôture',
              reason
            });
          }

          // Store in respective lists for averages
          if (r.isDorm) {
            completedDorms.push({
              date: s.date,
              roomNumber: r.roomBase,
              type: r.type,
              staffId: r.assignedStaffId,
              durationMin,
              isOutlier,
              isForceCompleted,
              completedAt: r.lastCompletedAt,
              bedsDoneCount: r.bedsDoneCount
            });
          } else {
            completedClassics.push({
              date: s.date,
              roomNumber: r.roomBase,
              type: r.type,
              staffId: r.assignedStaffId,
              durationMin,
              isOutlier,
              isForceCompleted,
              completedAt: r.lastCompletedAt
            });
          }
        }
      });
    });

    // Sort suspect validations by date & time descending (newest first)
    suspectValidations.sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      return b.time.localeCompare(a.time);
    });

    // Calculate Averages
    const validClassics = completedClassics.filter(c => !c.isOutlier && !c.isForceCompleted);
    const validClassicBlancs = validClassics.filter(c => c.type === 'blanc').map(c => c.durationMin).filter(v => v !== null);
    const validClassicRecouches = validClassics.filter(c => c.type === 'recouche').map(c => c.durationMin).filter(v => v !== null);

    const avgClassicBlanc = validClassicBlancs.length > 0
      ? Math.round(validClassicBlancs.reduce((a, b) => a + b, 0) / validClassicBlancs.length)
      : null;

    const avgClassicRecouche = validClassicRecouches.length > 0
      ? Math.round(validClassicRecouches.reduce((a, b) => a + b, 0) / validClassicRecouches.length)
      : null;

    const validDorms = completedDorms.filter(d => !d.isOutlier && !d.isForceCompleted);
    const totalDormTimeMin = validDorms.map(d => d.durationMin).filter(v => v !== null).reduce((a, b) => a + b, 0);
    const totalDormBeds = validDorms.reduce((sum, d) => sum + d.bedsDoneCount, 0);

    // Global time per bed in dorm
    const avgTimePerBed = totalDormBeds > 0 ? Math.round(totalDormTimeMin / totalDormBeds) : null;
    
    // Split by type for beds
    const validDormBlancs = validDorms.filter(d => d.type === 'blanc');
    const dormBlancsTime = validDormBlancs.map(d => d.durationMin).filter(v => v !== null).reduce((a, b) => a + b, 0);
    const dormBlancsBeds = validDormBlancs.reduce((sum, d) => sum + d.bedsDoneCount, 0);
    const avgBedBlanc = dormBlancsBeds > 0 ? Math.round(dormBlancsTime / dormBlancsBeds) : null;

    const validDormRecouches = validDorms.filter(d => d.type === 'recouche');
    const dormRecouchesTime = validDormRecouches.map(d => d.durationMin).filter(v => v !== null).reduce((a, b) => a + b, 0);
    const dormRecouchesBeds = validDormRecouches.reduce((sum, d) => sum + d.bedsDoneCount, 0);
    const avgBedRecouche = dormRecouchesBeds > 0 ? Math.round(dormRecouchesTime / dormRecouchesBeds) : null;

    const validDormBlancDurations = validDormBlancs.map(d => d.durationMin).filter(v => v !== null);
    const avgDormBlancBlock = validDormBlancDurations.length > 0
      ? Math.round(validDormBlancDurations.reduce((a, b) => a + b, 0) / validDormBlancDurations.length)
      : null;

    const validDormRecoucheDurations = validDormRecouches.map(d => d.durationMin).filter(v => v !== null);
    const avgDormRecoucheBlock = validDormRecoucheDurations.length > 0
      ? Math.round(validDormRecoucheDurations.reduce((a, b) => a + b, 0) / validDormRecoucheDurations.length)
      : null;

    // Calculate individual metrics for ALL staff members based on physical rooms & direct beds counts
    const staffStats = staff.map(s => {
      let daysWorked = 0;
      let totalShiftHours = 0;
      
      let classicCleaned = 0;
      let classicBlanc = 0;
      let classicRecouche = 0;

      let dormsCleaned = 0;
      let dormsBlanc = 0;
      let dormsRecouche = 0;

      let bedsCleaned = 0;
      let bedsBlanc = 0;
      let bedsRecouche = 0;

      let incidentsCount = 0;
      let dndCount = 0;
      let postponedCount = 0;

      filteredSummaries.forEach(sum => {
        const bs = sum.byStaff?.find(st => st.id === s.id);
        if (bs) {
          daysWorked++;
          totalShiftHours += getShiftHours(bs.shift_start, bs.shift_end);
          
          classicCleaned += bs.classicDone || 0;
          classicBlanc += bs.classicBlanc || 0;
          classicRecouche += bs.classicRecouche || 0;

          dormsCleaned += bs.dormsDone || 0;
          dormsBlanc += bs.dormsBlanc || 0;
          dormsRecouche += bs.dormsRecouche || 0;

          bedsCleaned += bs.bedsDone || 0;
          bedsBlanc += bs.bedsBlanc || 0;
          bedsRecouche += bs.bedsRecouche || 0;

          incidentsCount += bs.incidents || 0;
          dndCount += bs.dnd || 0;
          postponedCount += bs.postponed || 0;
        }
      });

      // Filter staff tasks (excluding outliers) for average speeds
      const staffClassics = completedClassics.filter(c => c.staffId === s.id && !c.isOutlier && !c.isForceCompleted);
      const staffDorms = completedDorms.filter(d => d.staffId === s.id && !d.isOutlier && !d.isForceCompleted);

      const staffClassicBlancTimes = staffClassics.filter(c => c.type === 'blanc').map(c => c.durationMin).filter(v => v !== null);
      const staffClassicRecoucheTimes = staffClassics.filter(c => c.type === 'recouche').map(c => c.durationMin).filter(v => v !== null);

      const avgClassicBlancLocal = staffClassicBlancTimes.length > 0
        ? Math.round(staffClassicBlancTimes.reduce((a, b) => a + b, 0) / staffClassicBlancTimes.length)
        : null;

      const avgClassicRecoucheLocal = staffClassicRecoucheTimes.length > 0
        ? Math.round(staffClassicRecoucheTimes.reduce((a, b) => a + b, 0) / staffClassicRecoucheTimes.length)
        : null;

      // Staff dorm time and bed time
      const staffDormTimeMin = staffDorms.map(d => d.durationMin).filter(v => v !== null).reduce((a, b) => a + b, 0);
      const staffDormBeds = staffDorms.reduce((sum, d) => sum + d.bedsDoneCount, 0);
      const avgBedTimeLocal = staffDormBeds > 0 ? Math.round(staffDormTimeMin / staffDormBeds) : null;

      const avgDormBlockLocal = staffDorms.length > 0
        ? Math.round(staffDorms.map(d => d.durationMin).filter(v => v !== null).reduce((a, b) => a + b, 0) / staffDorms.length)
        : null;

      // Ratios (Total Rooms Cleaned = Classics + Dorms)
      const totalPhysicalRoomsCleaned = classicCleaned + dormsCleaned;
      const roomsPerDay = daysWorked > 0 ? Math.round((totalPhysicalRoomsCleaned / daysWorked) * 10) / 10 : 0;
      const roomsPerHour = totalShiftHours > 0 ? Math.round((totalPhysicalRoomsCleaned / totalShiftHours) * 10) / 10 : 0;
      
      const incidentRate = totalPhysicalRoomsCleaned > 0 ? Math.round((incidentsCount / totalPhysicalRoomsCleaned) * 100) : 0;

      // Saisies suspectes (oublis de validation)
      const staffAllClassicsRaw = completedClassics.filter(c => c.staffId === s.id);
      const staffAllDormsRaw = completedDorms.filter(d => d.staffId === s.id);
      
      const outlierAttempts = staffAllClassicsRaw.length + staffAllDormsRaw.length;
      const outlierCount = staffAllClassicsRaw.filter(c => c.isOutlier || c.isForceCompleted).length + 
                           staffAllDormsRaw.filter(d => d.isOutlier || d.isForceCompleted).length;
                           
      const anomalyRate = outlierAttempts > 0 ? Math.round((outlierCount / outlierAttempts) * 100) : 0;

      return {
        id: s.id,
        name: s.name,
        daysWorked,
        totalShiftHours: Math.round(totalShiftHours * 10) / 10,
        
        // Physical Counts
        classicCleaned,
        classicBlanc,
        classicRecouche,
        dormsCleaned,
        dormsBlanc,
        dormsRecouche,
        totalPhysicalRoomsCleaned,

        // Bed Counts
        bedsCleaned,
        bedsBlanc,
        bedsRecouche,

        incidentsCount,
        dndCount,
        postponedCount,

        // Averages
        avgClassicBlanc: avgClassicBlancLocal,
        avgClassicRecouche: avgClassicRecoucheLocal,
        avgDormBlock: avgDormBlockLocal,
        avgBedTime: avgBedTimeLocal,

        roomsPerDay,
        roomsPerHour,
        incidentRate,
        anomalyRate
      };
    });

    // Global aggregated metrics
    const totalRooms = staffStats.reduce((sum, s) => sum + s.totalPhysicalRoomsCleaned, 0);
    const totalBeds = staffStats.reduce((sum, s) => sum + s.bedsCleaned, 0);
    const totalWorkedDays = staffStats.reduce((sum, s) => sum + s.daysWorked, 0);
    const totalShiftHours = staffStats.reduce((sum, s) => sum + s.totalShiftHours, 0);
    const globalRoomsPerHour = totalShiftHours > 0 ? Math.round((totalRooms / totalShiftHours) * 10) / 10 : 0;

    // Timeline 1: Room Ready (Disponibilité) - when housekeepers finish cleaning
    const readyHourlyBins = Array.from({ length: 10 }, (_, i) => {
      const hour = 8 + i; // 8h to 17h
      return {
        hour: `${hour}h`,
        hourNum: hour,
        'Chambres prêtes': 0
      };
    });

    completedClassics.concat(completedDorms).forEach(t => {
      if (t.completedAt) {
        const hour = t.completedAt.getHours();
        const bin = readyHourlyBins.find(b => b.hourNum === hour) || (hour >= 17 ? readyHourlyBins[9] : null);
        if (bin) {
          bin['Chambres prêtes']++;
        }
      }
    });

    // Timeline 2: Room Released (Libération / Checkouts) - standard 11h, late checkout, or freedAt click
    const releaseHourlyBins = Array.from({ length: 10 }, (_, i) => {
      const hour = 8 + i; // 8h to 17h
      return {
        hour: `${hour}h`,
        hourNum: hour,
        'Chambres libérées': 0
      };
    });

    filteredSummaries.forEach(s => {
      const snapshot = s.tasksSnapshot || [];
      snapshot.forEach(t => {
        // Checkout release is only relevant for checkout rooms (type 'blanc')
        if (t.cleaning_type === 'blanc') {
          const releaseTime = getReleaseTime(t, s.date);
          if (releaseTime) {
            const hour = releaseTime.getHours();
            const bin = releaseHourlyBins.find(b => b.hourNum === hour) || (hour >= 17 ? releaseHourlyBins[9] : (hour < 8 ? releaseHourlyBins[0] : null));
            if (bin) {
              bin['Chambres libérées']++;
            }
          }
        }
      });
    });

    // Leaderboard Podium sorting
    const podiumVolume = [...staffStats].sort((a, b) => (b.classicCleaned + b.bedsCleaned) - (a.classicCleaned + a.bedsCleaned)).slice(0, 3);
    const podiumSpeed = [...staffStats]
      .filter(s => s.avgClassicBlanc !== null)
      .sort((a, b) => a.avgClassicBlanc - b.avgClassicBlanc)
      .slice(0, 3);
    const podiumEfficiency = [...staffStats].sort((a, b) => b.roomsPerHour - a.roomsPerHour).slice(0, 3);

    // Compute daily adequacy metrics (workload vs capacity) for the calendar and daily table
    const adequacyCalendar = filteredSummaries
      .sort((a, b) => b.date.localeCompare(a.date)) // Newest first
      .map(s => {
        const dayDoneClassicBlanc = s.byStaff ? s.byStaff.reduce((sum, st) => sum + (st.classicBlanc || 0), 0) : 0;
        const dayDoneClassicRecouche = s.byStaff ? s.byStaff.reduce((sum, st) => sum + (st.classicRecouche || 0), 0) : 0;
        const dayDoneBedsBlanc = s.byStaff ? s.byStaff.reduce((sum, st) => sum + (st.bedsBlanc || 0), 0) : 0;
        const dayDoneBedsRecouche = s.byStaff ? s.byStaff.reduce((sum, st) => sum + (st.bedsRecouche || 0), 0) : 0;
        
        const avgCB = avgClassicBlanc || 25;
        const avgCR = avgClassicRecouche || 12;
        const avgBB = avgBedBlanc || 10;
        const avgBR = avgBedRecouche || 5;

        // Estimated workload in minutes
        const estWorkloadMin = (dayDoneClassicBlanc * avgCB) + 
                               (dayDoneClassicRecouche * avgCR) + 
                               (dayDoneBedsBlanc * avgBB) + 
                               (dayDoneBedsRecouche * avgBR);

        const estWorkloadHours = Math.round((estWorkloadMin / 60) * 10) / 10;
        const capacityHours = s.byStaff ? s.byStaff.reduce((sum, st) => sum + getShiftHours(st.shift_start, st.shift_end), 0) : 0;
        const staffCount = s.byStaff ? s.byStaff.length : 0;

        let status = 'good';
        let label = 'Adéquat 🟢';
        let color = '#D1FAE5'; // Emerald 100 bg
        let textColor = '#065F46'; // Emerald 800 text
        let borderColor = '#10B981'; // Emerald 500 border

        if (capacityHours === 0) {
          status = 'undefined';
          label = 'Non défini ⚪';
          color = '#F3F4F6';
          textColor = '#374151';
          borderColor = '#9CA3AF';
        } else {
          const ratio = estWorkloadHours / capacityHours;
          if (ratio < 0.8) {
            status = 'overstaffed';
            label = 'Sur-effectif 🟡';
            color = '#FEF3C7';
            textColor = '#92400E';
            borderColor = '#F59E0B';
          } else if (ratio > 1.1) {
            status = 'understaffed';
            label = 'Sous-effectif 🔴';
            color = '#FEE2E2';
            textColor = '#991B1B';
            borderColor = '#EF4444';
          }
        }

        const dateObj = new Date(s.date + 'T00:00:00');
        const formattedDate = dateObj.toLocaleDateString('fr-FR', {
          weekday: 'short',
          day: 'numeric',
          month: 'short'
        });

        return {
          date: s.date,
          formattedDate,
          workload: estWorkloadHours,
          capacity: Math.round(capacityHours * 10) / 10,
          diff: Math.round((capacityHours - estWorkloadHours) * 10) / 10,
          staffCount,
          status,
          label,
          color,
          textColor,
          borderColor,
          
          // Breakdown counts
          classicBlancCount: dayDoneClassicBlanc,
          classicRecoucheCount: dayDoneClassicRecouche,
          bedsBlancCount: dayDoneBedsBlanc,
          bedsRecoucheCount: dayDoneBedsRecouche
        };
      });

    // Chart data for cumulative presence hours
    const staffHoursData = staffStats
      .filter(s => s.totalShiftHours > 0)
      .map(s => ({
        name: s.name,
        'Heures de shift': s.totalShiftHours
      }));

    return {
      staffStats,
      totalRooms,
      totalBeds,
      totalWorkedDays,
      totalShiftHours: Math.round(totalShiftHours),
      avgClassicBlanc,
      avgClassicRecouche,
      avgTimePerBed,
      avgBedBlanc,
      avgBedRecouche,
      avgDormBlancBlock,
      avgDormRecoucheBlock,
      globalRoomsPerHour,
      readyHourlyData: readyHourlyBins,
      releaseHourlyData: releaseHourlyBins,
      suspectValidations,
      podiums: {
        volume: podiumVolume,
        speed: podiumSpeed,
        efficiency: podiumEfficiency
      },
      adequacyCalendar,
      staffHoursData
    };
  }, [tasks, staff, reports, period, customStartDate, customEndDate]);

  // Lock screen view if not unlocked yet
  if (!isUnlocked) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '55vh', padding: '24px' }}>
        <Card className="bg-white border-gray-200 shadow-sm" style={{ width: '100%', maxWidth: '400px' }}>
          <CardContent style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
            <h2 className="text-lg font-bold text-gray-800" style={{ marginBottom: '8px' }}>Accès Sécurisé</h2>
            <p className="text-sm text-gray-500" style={{ marginBottom: '24px' }}>
              Veuillez entrer le code d'accès pour visualiser les statistiques de performance.
            </p>
            
            <form onSubmit={handleUnlockSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <input
                type="password"
                placeholder="Code d'accès"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid #E5E7EB',
                  fontSize: '14px',
                  textAlign: 'center',
                  outline: 'none',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)'
                }}
                autoFocus
              />
              
              {passwordError && (
                <p style={{ color: '#EF4444', fontSize: '12px', fontWeight: '600' }}>{passwordError}</p>
              )}
              
              <Button type="submit" className="w-full">
                Déverrouiller
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12" style={{ paddingLeft: '8px', paddingRight: '8px' }}>
      
      {/* Date Period Picker Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white rounded-xl border border-gray-200 shadow-sm" style={{ padding: '20px 24px' }}>
        <div>
          <h2 className="text-lg font-bold text-gray-800">Tableau de bord de performance</h2>
          <p className="text-sm text-gray-500">Statistiques granulaires pour chambres classiques, dortoirs entiers et lits</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-lg">
            {[
              { id: 'today', label: "Aujourd'hui" },
              { id: 'week', label: 'Cette semaine' },
              { id: 'month', label: 'Ce mois' },
              { id: 'year', label: 'Cette année' },
              { id: 'custom', label: 'Période' },
              { id: 'all', label: 'Tout' }
            ].map(p => (
              <Button
                key={p.id}
                variant={period === p.id ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setPeriod(p.id)}
                className="h-8 text-xs font-medium px-3"
              >
                {p.label}
              </Button>
            ))}
          </div>

          {/* Custom Date Range Picker */}
          {period === 'custom' && (
            <div className="flex items-center gap-2 p-1.5 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-1 text-xs text-gray-500 font-medium">
                <span>Du</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  style={{
                    padding: '4px 8px',
                    border: '1px solid #E5E7EB',
                    borderRadius: '6px',
                    fontSize: '11px',
                    outline: 'none',
                    background: 'white'
                  }}
                />
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-500 font-medium">
                <span>Au</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  style={{
                    padding: '4px 8px',
                    border: '1px solid #E5E7EB',
                    borderRadius: '6px',
                    fontSize: '11px',
                    outline: 'none',
                    background: 'white'
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Primary KPI Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent style={{ padding: '20px 24px' }}>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Volume Clean</div>
            <div className="text-3xl font-extrabold text-emerald-600 mt-2">
              {stats.totalRooms} <span className="text-sm font-semibold text-gray-400">ch</span> / {stats.totalBeds} <span className="text-sm font-semibold text-gray-400">lits</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">Chambres physiques et lits de dortoirs faits</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent style={{ padding: '20px 24px' }}>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Temps moyen Classique / Lit</div>
            <div className="text-xl font-extrabold text-indigo-600 mt-2">
              Ch: {stats.avgClassicBlanc ? `${stats.avgClassicBlanc}m` : '--'}/{stats.avgClassicRecouche ? `${stats.avgClassicRecouche}m` : '--'}
              <span className="block text-xs font-normal text-gray-400 mt-1">
                Lit dortoir : {stats.avgTimePerBed ? `${stats.avgTimePerBed} min` : '--'}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent style={{ padding: '20px 24px' }}>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Heures de présence totales</div>
            <div className="text-3xl font-extrabold text-gray-800 mt-2">{stats.totalShiftHours} h</div>
            <div className="text-xs text-gray-500 mt-1">Cumulé sur {stats.totalWorkedDays} jours de travail</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent style={{ padding: '20px 24px' }}>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Efficacité moyenne</div>
            <div className="text-3xl font-extrabold text-amber-600 mt-2">{stats.globalRoomsPerHour} <span className="text-sm font-normal text-gray-500">ch/h</span></div>
            <div className="text-xs text-gray-500 mt-1">Chambres physiques nettoyées par heure de shift</div>
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard Podiums Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Podium Volume */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent style={{ padding: '24px' }}>
            <h3 className="text-sm font-bold text-gray-800 mb-4 text-center">🏆 Volume (Total classique + lits)</h3>
            <div className="flex justify-center items-end space-x-2 h-36 pt-4">
              {/* 2nd Place */}
              {stats.podiums.volume[1] && (
                <div className="flex flex-col items-center w-20">
                  <span className="text-xs text-gray-600 font-medium truncate w-full text-center">{stats.podiums.volume[1].name}</span>
                  <div className="bg-gray-200 w-full h-16 rounded-t-lg flex items-center justify-center font-bold text-gray-600 mt-1">
                    {stats.podiums.volume[1].classicCleaned + stats.podiums.volume[1].bedsCleaned}
                  </div>
                  <span className="text-[10px] text-gray-400 font-semibold mt-1">2ème</span>
                </div>
              )}
              {/* 1st Place */}
              {stats.podiums.volume[0] && (
                <div className="flex flex-col items-center w-24">
                  <span className="text-xs text-indigo-600 font-bold truncate w-full text-center">👑 {stats.podiums.volume[0].name}</span>
                  <div className="bg-indigo-500 w-full h-24 rounded-t-lg flex items-center justify-center font-extrabold text-white mt-1 shadow-md">
                    {stats.podiums.volume[0].classicCleaned + stats.podiums.volume[0].bedsCleaned}
                  </div>
                  <span className="text-[10px] text-indigo-500 font-bold mt-1">1er</span>
                </div>
              )}
              {/* 3rd Place */}
              {stats.podiums.volume[2] && (
                <div className="flex flex-col items-center w-20">
                  <span className="text-xs text-gray-600 font-medium truncate w-full text-center">{stats.podiums.volume[2].name}</span>
                  <div className="bg-orange-100 w-full h-12 rounded-t-lg flex items-center justify-center font-bold text-orange-700 mt-1">
                    {stats.podiums.volume[2].classicCleaned + stats.podiums.volume[2].bedsCleaned}
                  </div>
                  <span className="text-[10px] text-orange-600 font-semibold mt-1">3ème</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Podium Speed */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent style={{ padding: '24px' }}>
            <h3 className="text-sm font-bold text-gray-800 mb-4 text-center">⚡ Vitesse (Moyenne classique)</h3>
            <div className="flex justify-center items-end space-x-2 h-36 pt-4">
              {/* 2nd Place */}
              {stats.podiums.speed[1] && (
                <div className="flex flex-col items-center w-20">
                  <span className="text-xs text-gray-600 font-medium truncate w-full text-center">{stats.podiums.speed[1].name}</span>
                  <div className="bg-gray-200 w-full h-16 rounded-t-lg flex items-center justify-center font-bold text-gray-600 mt-1">
                    {stats.podiums.speed[1].avgClassicBlanc}m
                  </div>
                  <span className="text-[10px] text-gray-400 font-semibold mt-1">2ème</span>
                </div>
              )}
              {/* 1st Place */}
              {stats.podiums.speed[0] && (
                <div className="flex flex-col items-center w-24">
                  <span className="text-xs text-indigo-600 font-bold truncate w-full text-center">👑 {stats.podiums.speed[0].name}</span>
                  <div className="bg-indigo-500 w-full h-24 rounded-t-lg flex items-center justify-center font-extrabold text-white mt-1 shadow-md">
                    {stats.podiums.speed[0].avgClassicBlanc}m
                  </div>
                  <span className="text-[10px] text-indigo-500 font-bold mt-1">1er</span>
                </div>
              )}
              {/* 3rd Place */}
              {stats.podiums.speed[2] && (
                <div className="flex flex-col items-center w-20">
                  <span className="text-xs text-gray-600 font-medium truncate w-full text-center">{stats.podiums.speed[2].name}</span>
                  <div className="bg-orange-100 w-full h-12 rounded-t-lg flex items-center justify-center font-bold text-orange-700 mt-1">
                    {stats.podiums.speed[2].avgClassicBlanc}m
                  </div>
                  <span className="text-[10px] text-orange-600 font-semibold mt-1">3ème</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Podium Efficiency */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent style={{ padding: '24px' }}>
            <h3 className="text-sm font-bold text-gray-800 mb-4 text-center">📈 Rendement (Chambres/heure)</h3>
            <div className="flex justify-center items-end space-x-2 h-36 pt-4">
              {/* 2nd Place */}
              {stats.podiums.efficiency[1] && (
                <div className="flex flex-col items-center w-20">
                  <span className="text-xs text-gray-600 font-medium truncate w-full text-center">{stats.podiums.efficiency[1].name}</span>
                  <div className="bg-gray-200 w-full h-16 rounded-t-lg flex items-center justify-center font-bold text-gray-600 mt-1">
                    {stats.podiums.efficiency[1].roomsPerHour}/h
                  </div>
                  <span className="text-[10px] text-gray-400 font-semibold mt-1">2ème</span>
                </div>
              )}
              {/* 1st Place */}
              {stats.podiums.efficiency[0] && (
                <div className="flex flex-col items-center w-24">
                  <span className="text-xs text-indigo-600 font-bold truncate w-full text-center">👑 {stats.podiums.efficiency[0].name}</span>
                  <div className="bg-indigo-500 w-full h-24 rounded-t-lg flex items-center justify-center font-extrabold text-white mt-1 shadow-md">
                    {stats.podiums.efficiency[0].roomsPerHour}/h
                  </div>
                  <span className="text-[10px] text-indigo-500 font-bold mt-1">1er</span>
                </div>
              )}
              {/* 3rd Place */}
              {stats.podiums.efficiency[2] && (
                <div className="flex flex-col items-center w-20">
                  <span className="text-xs text-gray-600 font-medium truncate w-full text-center">{stats.podiums.efficiency[2].name}</span>
                  <div className="bg-orange-100 w-full h-12 rounded-t-lg flex items-center justify-center font-bold text-orange-700 mt-1">
                    {stats.podiums.efficiency[2].roomsPerHour}/h
                  </div>
                  <span className="text-[10px] text-orange-600 font-semibold mt-1">3ème</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Stats Table */}
      <Card className="bg-white border border-gray-200 shadow-sm overflow-hidden">
        <CardContent style={{ padding: '0' }}>
          <div className="border-b border-gray-100" style={{ padding: '20px 24px' }}>
            <h3 className="text-base font-bold text-gray-800">Synthèse détaillée par collaborateur</h3>
            <p className="text-xs text-gray-400 mt-1">Données détaillées pour chambres classiques, dortoirs entiers et lits individuels</p>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-400 font-semibold uppercase text-[10px] tracking-wider border-b border-gray-100">
                  <th style={{ padding: '12px 16px' }}>Collaborateur</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Jours</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Présence</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Chambres Cl.</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Dortoirs Ph.</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Lits faits</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Moy. Classique (B/R)</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Moy. Dortoir entier</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Moy. Lit</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Incidents</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Saisies Suspectes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stats.staffStats.map((s, index) => (
                  <tr key={index} className="hover:bg-gray-50 text-gray-700">
                    <td style={{ padding: '12px 16px', fontWeight: '600' }} className="text-gray-800">{s.name}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '500' }}>{s.daysWorked}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>{s.totalShiftHours} h</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 'bold' }} className="text-emerald-600">
                      {s.classicCleaned} <span className="text-[10px] text-gray-400 font-normal">({s.classicBlanc}B/{s.classicRecouche}R)</span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 'bold' }} className="text-indigo-600">
                      {s.dormsCleaned} <span className="text-[10px] text-gray-400 font-normal">({s.dormsBlanc}B/{s.dormsRecouche}R)</span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 'bold' }} className="text-amber-600">
                      {s.bedsCleaned} <span className="text-[10px] text-gray-400 font-normal">({s.bedsBlanc}B/{s.bedsRecouche}R)</span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', fontWeight: '500' }}>
                      {s.avgClassicBlanc !== null ? `${s.avgClassicBlanc}m` : '--'} / {s.avgClassicRecouche !== null ? `${s.avgClassicRecouche}m` : '--'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', fontWeight: '500' }}>
                      {s.avgDormBlock !== null ? `${s.avgDormBlock} min` : '--'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px', fontWeight: '600' }} className="text-indigo-600">
                      {s.avgBedTime !== null ? `${s.avgBedTime} min` : '--'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <Badge variant={s.incidentRate > 20 ? 'destructive' : 'secondary'} className="text-[10px]">
                        {s.incidentsCount} ({s.incidentRate}%)
                      </Badge>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      {s.anomalyRate > 0 ? (
                        <span className="text-red-500 font-semibold text-xs">
                          ⚠️ {s.anomalyRate}%
                        </span>
                      ) : (
                        <span className="text-emerald-500 text-xs font-semibold">Correct ✅</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Visualizations row: Dual Timelines (Checkouts vs Ready) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Timeline 1: Libération des Chambres (Départs clients) */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent style={{ padding: '24px' }}>
            <div className="mb-4">
              <h3 className="text-sm font-bold text-gray-800">Timeline de libération des chambres (Départs clients)</h3>
              <p className="text-xs text-gray-400 mt-1">
                Basé sur le clic « Libérer » dans le dashboard, les Late Checkouts configurés, ou l'heure de départ par défaut à 11h
              </p>
            </div>
            
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.releaseHourlyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="hour" stroke="#6B7280" fontSize={11} />
                  <YAxis stroke="#6B7280" fontSize={11} allowDecimals={false} />
                  <Tooltip formatter={(value) => [`${value} départs`]} />
                  <Bar dataKey="Chambres libérées" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Timeline 2: Disponibilité (Chambres prêtes) */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent style={{ padding: '24px' }}>
            <div className="mb-4">
              <h3 className="text-sm font-bold text-gray-800">Timeline de disponibilité (Chambres prêtes)</h3>
              <p className="text-xs text-gray-400 mt-1">
                Basé sur le moment où les femmes de chambres cliquent sur « Terminé » (fin réelle du ménage)
              </p>
            </div>
            
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.readyHourlyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="hour" stroke="#6B7280" fontSize={11} />
                  <YAxis stroke="#6B7280" fontSize={11} allowDecimals={false} />
                  <Tooltip formatter={(value) => [`${value} chambres prêtes`]} />
                  <Bar dataKey="Chambres prêtes" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Secondary visualizations row: Cumulative presence hours */}
      <div className="grid grid-cols-1 gap-6">
        {/* Worked Hours Chart */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent style={{ padding: '24px' }}>
            <div className="mb-4">
              <h3 className="text-sm font-bold text-gray-800">Heures de présence cumulées par collaborateur</h3>
              <p className="text-xs text-gray-400 mt-1">Total des heures de shift enregistrées sur la période</p>
            </div>
            
            {stats.staffHoursData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-400">
                Aucune heure travaillée enregistrée sur cette période
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.staffHoursData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                    <XAxis dataKey="name" stroke="#6B7280" fontSize={11} />
                    <YAxis stroke="#6B7280" fontSize={11} unit=" h" />
                    <Tooltip formatter={(value) => [`${value} h`]} />
                    <Bar dataKey="Heures de shift" fill="#818CF8" barSize={40} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Retroactive staffing adequacy calendar */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardContent style={{ padding: '24px' }}>
          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-800">Calendrier rétroactif d'adéquation des effectifs</h3>
            <p className="text-xs text-gray-400 mt-1">
              Analyse rapide de l'équilibre quotidien entre la charge théorique (heures de ménage estimées) et la capacité réelle (shifts).
            </p>
          </div>

          {stats.adequacyCalendar.length === 0 ? (
            <div className="py-8 text-center text-gray-400 font-semibold text-sm">
              Aucune donnée d'adéquation disponible pour la période sélectionnée.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-4">
              {stats.adequacyCalendar.map((day, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: 'white',
                    border: `1px solid ${day.borderColor}`,
                    borderRadius: '12px',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    minHeight: '120px'
                  }}
                >
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-gray-800 capitalize">
                      {day.formattedDate}
                    </span>
                    <span className="text-[10px] font-semibold text-gray-400">
                      {day.staffCount} pers
                    </span>
                  </div>

                  <div className="my-2 text-center">
                    <span
                      style={{
                        backgroundColor: day.color,
                        color: day.textColor,
                        fontSize: '10px',
                        fontWeight: 'bold',
                        padding: '3px 8px',
                        borderRadius: '20px',
                        display: 'inline-block'
                      }}
                    >
                      {day.label}
                    </span>
                  </div>

                  <div className="text-[10px] text-gray-500 font-medium space-y-0.5">
                    <div className="flex justify-between">
                      <span>Charge :</span>
                      <span className="font-bold">{day.workload} h</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Capacité :</span>
                      <span className="font-bold">{day.capacity} h</span>
                    </div>
                    {day.capacity > 0 && (
                      <div className="flex justify-between border-t border-dashed border-gray-150 pt-1 mt-1 font-semibold">
                        <span>Adéquation :</span>
                        <span style={{ color: day.textColor }}>
                          {Math.round((day.workload / day.capacity) * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detailed daily workload vs capacity table */}
      <Card className="bg-white border border-gray-200 shadow-sm overflow-hidden">
        <CardContent style={{ padding: '0' }}>
          <div className="border-b border-gray-100" style={{ padding: '20px 24px' }}>
            <h3 className="text-base font-bold text-gray-800">Rapport d'adéquation Charge / Capacité quotidien</h3>
            <p className="text-xs text-gray-400 mt-1">Détail des chambres (Blanc / Recouche), lits de dortoirs et des écarts horaires</p>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-400 font-semibold uppercase text-[10px] tracking-wider border-b border-gray-100">
                  <th style={{ padding: '12px 16px' }}>Date</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Effectif présent (ETP)</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Chambres Classiques (B / R)</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Lits Dortoirs (B / R)</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Charge estimée</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Capacité de shift</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Écart (h)</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Diagnostic</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stats.adequacyCalendar.map((day, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 text-gray-700">
                    <td style={{ padding: '12px 16px', fontWeight: '600' }} className="text-gray-800 capitalize">{day.formattedDate}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '500' }}>{day.staffCount} pers</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span className="font-semibold text-emerald-600">{day.classicBlancCount + day.classicRecoucheCount}</span>
                      <span className="text-[11px] text-gray-400 ml-1">({day.classicBlancCount}B / {day.classicRecoucheCount}R)</span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span className="font-semibold text-amber-600">{day.bedsBlancCount + day.bedsRecoucheCount}</span>
                      <span className="text-[11px] text-gray-400 ml-1">({day.bedsBlancCount}B / {day.bedsRecoucheCount}R)</span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '500' }}>{day.workload} h</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '500' }}>{day.capacity} h</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 'bold' }}>
                      {day.capacity === 0 ? (
                        <span className="text-gray-400">--</span>
                      ) : day.diff < 0 ? (
                        <span className="text-red-600">🚨 {day.diff} h</span>
                      ) : (
                        <span className="text-emerald-600">🟢 +{day.diff} h</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span
                        style={{
                          backgroundColor: day.color,
                          color: day.textColor,
                          fontSize: '11px',
                          fontWeight: 'bold',
                          padding: '3px 8px',
                          borderRadius: '12px'
                        }}
                      >
                        {day.label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Suspect validations alerts block */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardContent style={{ padding: '24px' }}>
          <div className="mb-4">
            <h3 className="text-sm font-bold text-gray-800">⚠️ Alertes de saisies suspectes (Hors réalité)</h3>
            <p className="text-xs text-gray-400 mt-1">Validations ultra-rapides (&lt;2 min), oublis de validation (&gt;60 min), ou clôtures forcées au rapport</p>
          </div>

          {stats.suspectValidations.length === 0 ? (
            <div className="py-8 text-center text-emerald-600 font-semibold text-sm bg-emerald-50 rounded-lg">
              Aucune validation suspecte détectée sur cette période. Bravo !
            </div>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-red-50 text-red-700 font-semibold text-xs border-b border-red-100">
                    <th style={{ padding: '8px 16px' }}>Date</th>
                    <th style={{ padding: '8px 16px' }}>Heure</th>
                    <th style={{ padding: '8px 16px' }}>Chambre</th>
                    <th style={{ padding: '8px 16px' }}>Employé</th>
                    <th style={{ padding: '8px 16px', textAlign: 'center' }}>Durée enregistrée</th>
                    <th style={{ padding: '8px 16px' }}>Type d'erreur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {stats.suspectValidations.map((a, idx) => (
                    <tr key={idx} className="hover:bg-red-50 text-gray-700">
                      <td style={{ padding: '8px 16px' }} className="text-xs font-medium">{a.date}</td>
                      <td style={{ padding: '8px 16px' }} className="text-xs">{a.time}</td>
                      <td style={{ padding: '8px 16px', fontWeight: 'bold' }} className="text-red-700">Chambre {a.roomNumber}</td>
                      <td style={{ padding: '8px 16px', fontWeight: '500' }}>{a.staffName}</td>
                      <td style={{ padding: '8px 16px', textAlign: 'center', fontWeight: 'bold' }} className="text-red-600">
                        {a.durationMin === '--' ? '--' : `${a.durationMin} min`}
                      </td>
                      <td style={{ padding: '8px 16px' }} className="text-xs text-red-600 font-semibold">{a.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      
    </div>
  );
}
