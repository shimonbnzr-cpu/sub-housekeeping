import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend, 
  AreaChart, 
  Area, 
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
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
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

// Compiles a task list (snapshot) by grouping beds into single physical room units
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

    const assignedStaffId = assignedTasks.length > 0 ? assignedTasks[0].cleaning_assignedTo : null;
    const type = r.tasks.length > 0 ? r.tasks[0].cleaning_type : 'recouche';
    const incidentText = r.tasks.find(t => t.cleaning_incident && t.cleaning_incident !== 'Ne pas déranger')?.cleaning_incident || null;

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
      roomBase,
      isDone,
      isInProgress,
      isDnd,
      isPostponed,
      assignedStaffId,
      type,
      incidentText,
      firstStartedAt,
      lastCompletedAt,
      durationMin
    };
  });

  // Re-calculate the staff metrics based on unique physical rooms cleaned
  const presentStaffIds = s.byStaff 
    ? s.byStaff.map(st => st.id) 
    : Array.from(new Set(physicalRooms.map(r => r.assignedStaffId).filter(id => id !== null)));
  
  const byStaff = presentStaffIds.map(staffId => {
    const staffMember = staff.find(st => st.id === staffId);
    const staffRooms = physicalRooms.filter(r => r.assignedStaffId === staffId);
    
    const doneRooms = staffRooms.filter(r => r.isDone);
    const blancRooms = doneRooms.filter(r => r.type === 'blanc');
    const recoucheRooms = doneRooms.filter(r => r.type === 'recouche');
    const incidentRooms = staffRooms.filter(r => r.incidentText);
    const postponedRooms = staffRooms.filter(r => r.isPostponed);
    const dndRooms = staffRooms.filter(r => r.isDnd);

    const bsOriginal = s.byStaff?.find(st => st.id === staffId);
    const shift_start = bsOriginal ? bsOriginal.shift_start : (staffMember?.shift_start || null);
    const shift_end = bsOriginal ? bsOriginal.shift_end : (staffMember?.shift_end || null);

    return {
      id: staffId,
      name: staffMember?.name || bsOriginal?.name || 'Inconnu',
      done: doneRooms.length,
      blanc: blancRooms.length,
      recouche: recoucheRooms.length,
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
    // 1. Helper to check if a date falls within the selected period (accesses states inside useMemo)
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

    // 2. Compile today's live summary and merge with historical reports
    const todaySummary = compileTodaySummary(tasks, staff);
    const combinedSummaries = [
      ...reports.filter(r => r.date !== todaySummary.date),
      todaySummary
    ];

    // 3. Process all summaries to group task listings by physical room unit
    const processedSummaries = combinedSummaries.map(s => {
      if (s.tasksSnapshot && s.tasksSnapshot.length > 0) {
        return compilePhysicalSummary(s, staff);
      }
      return s;
    });

    // 4. Filter summaries in the active date period
    const filteredSummaries = processedSummaries.filter(s => checkInRange(s.date));

    // 5. Extract and parse all completed physical rooms details across the period
    const completedTasksList = [];
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

          completedTasksList.push({
            date: s.date,
            roomNumber: r.roomBase,
            type: r.type,
            staffId: r.assignedStaffId,
            durationMin,
            isOutlier,
            completedAt: r.lastCompletedAt
          });

          // Suspect validation log (Alerts)
          if (isOutlier) {
            const staffName = staff.find(st => st.id === r.assignedStaffId)?.name || 'Inconnu';
            suspectValidations.push({
              date: s.date,
              roomNumber: r.roomBase,
              staffName,
              durationMin: Math.round(durationMin * 10) / 10,
              time: r.lastCompletedAt ? r.lastCompletedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '',
              reason: durationMin < MIN_LIMIT_MIN ? 'Trop rapide (< 2 min)' : 'Oubli de validation (> 60 min)'
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

    // 6. Calculate individual metrics for ALL staff members based on physical rooms
    const staffStats = staff.map(s => {
      let daysWorked = 0;
      let totalShiftHours = 0;
      let roomsCleaned = 0;
      let blancCleaned = 0;
      let recoucheCleaned = 0;
      let incidentsCount = 0;
      let dndCount = 0;
      let postponedCount = 0;

      // Scan summaries for shifts and presence
      filteredSummaries.forEach(sum => {
        const bs = sum.byStaff?.find(st => st.id === s.id);
        if (bs) {
          daysWorked++;
          totalShiftHours += getShiftHours(bs.shift_start, bs.shift_end);
          roomsCleaned += bs.done || 0;
          blancCleaned += bs.blanc || 0;
          recoucheCleaned += bs.recouche || 0;
          incidentsCount += bs.incidents || 0;
          dndCount += bs.dnd || 0;
          postponedCount += bs.postponed || 0;
        }
      });

      // Filter tasks for this staff member (exclude outliers for cleaning speed averages)
      const staffTasks = completedTasksList.filter(t => t.staffId === s.id);
      const validStaffTasks = staffTasks.filter(t => !t.isOutlier);
      
      const validBlancDurations = validStaffTasks.filter(t => t.type === 'blanc').map(t => t.durationMin).filter(v => v !== null);
      const validRecoucheDurations = validStaffTasks.filter(t => t.type === 'recouche').map(t => t.durationMin).filter(v => v !== null);

      const avgBlanc = validBlancDurations.length > 0 
        ? Math.round(validBlancDurations.reduce((a, b) => a + b, 0) / validBlancDurations.length)
        : null;
        
      const avgRecouche = validRecoucheDurations.length > 0 
        ? Math.round(validRecoucheDurations.reduce((a, b) => a + b, 0) / validRecoucheDurations.length)
        : null;

      const allValidDurations = [...validBlancDurations, ...validRecoucheDurations];
      const avgSpeed = allValidDurations.length > 0
        ? Math.round(allValidDurations.reduce((a, b) => a + b, 0) / allValidDurations.length)
        : null;

      // Ratios
      const roomsPerDay = daysWorked > 0 ? Math.round((roomsCleaned / daysWorked) * 10) / 10 : 0;
      const roomsPerHour = totalShiftHours > 0 ? Math.round((roomsCleaned / totalShiftHours) * 10) / 10 : 0;
      const incidentRate = roomsCleaned > 0 ? Math.round((incidentsCount / roomsCleaned) * 100) : 0;
      
      const outlierAttempts = staffTasks.length;
      const outlierCount = staffTasks.filter(t => t.isOutlier).length;
      const anomalyRate = outlierAttempts > 0 ? Math.round((outlierCount / outlierAttempts) * 100) : 0;

      return {
        id: s.id,
        name: s.name,
        daysWorked,
        totalShiftHours: Math.round(totalShiftHours * 10) / 10,
        roomsCleaned,
        blancCleaned,
        recoucheCleaned,
        incidentsCount,
        dndCount,
        postponedCount,
        avgBlanc,
        avgRecouche,
        avgSpeed,
        roomsPerDay,
        roomsPerHour,
        incidentRate,
        anomalyRate
      };
    });

    // 7. Global aggregated metrics (based on physical rooms)
    const totalRooms = staffStats.reduce((sum, s) => sum + s.roomsCleaned, 0);
    const totalWorkedDays = staffStats.reduce((sum, s) => sum + s.daysWorked, 0);
    const totalShiftHours = staffStats.reduce((sum, s) => sum + s.totalShiftHours, 0);
    
    const allValidBlanc = completedTasksList.filter(t => !t.isOutlier && t.type === 'blanc').map(t => t.durationMin);
    const allValidRecouche = completedTasksList.filter(t => !t.isOutlier && t.type === 'recouche').map(t => t.durationMin);

    const globalAvgBlanc = allValidBlanc.length > 0 
      ? Math.round(allValidBlanc.reduce((a, b) => a + b, 0) / allValidBlanc.length) 
      : null;

    const globalAvgRecouche = allValidRecouche.length > 0 
      ? Math.round(allValidRecouche.reduce((a, b) => a + b, 0) / allValidRecouche.length) 
      : null;

    const globalRoomsPerHour = totalShiftHours > 0 ? Math.round((totalRooms / totalShiftHours) * 10) / 10 : 0;

    // 8. Timelines of completions by hour of the day (based on physical rooms)
    const hourlyBins = Array.from({ length: 10 }, (_, i) => {
      const hour = 8 + i; // 8h to 17h
      return {
        hour: `${hour}h`,
        hourNum: hour,
        'Chambres libérées': 0
      };
    });

    completedTasksList.forEach(t => {
      if (t.completedAt) {
        const hour = t.completedAt.getHours();
        const bin = hourlyBins.find(b => b.hourNum === hour) || (hour >= 17 ? hourlyBins[9] : null);
        if (bin) {
          bin['Chambres libérées']++;
        }
      }
    });

    // 9. Leaderboard Podium sorting
    const podiumVolume = [...staffStats].sort((a, b) => b.roomsCleaned - a.roomsCleaned).slice(0, 3);
    const podiumSpeed = [...staffStats]
      .filter(s => s.avgSpeed !== null)
      .sort((a, b) => a.avgSpeed - b.avgSpeed)
      .slice(0, 3);
    const podiumEfficiency = [...staffStats].sort((a, b) => b.roomsPerHour - a.roomsPerHour).slice(0, 3);

    // 10. Progress trend chart data
    const trendData = filteredSummaries
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => {
        const parts = s.date.split('-');
        const shortDate = parts.length === 3 ? `${parts[2]}/${parts[1]}` : s.date;
        const total = s.summary?.total || 0;
        const done = s.summary?.done || 0;
        const rate = total > 0 ? Math.round((done / total) * 100) : 0;
        return {
          date: shortDate,
          'Taux de complétion (%)': rate,
          'Chambres nettoyées': done
        };
      });

    // 11. Compute daily adequacy metrics (workload vs capacity) for the calendar using physical rooms
    const adequacyCalendar = filteredSummaries
      .sort((a, b) => b.date.localeCompare(a.date)) // Newest first
      .map(s => {
        const dayDoneBlanc = s.byStaff ? s.byStaff.reduce((sum, st) => sum + (st.blanc || 0), 0) : 0;
        const dayDoneRecouche = s.byStaff ? s.byStaff.reduce((sum, st) => sum + (st.recouche || 0), 0) : 0;
        
        const avgB = globalAvgBlanc || 25;
        const avgR = globalAvgRecouche || 12;
        const estWorkloadMin = (dayDoneBlanc * avgB) + (dayDoneRecouche * avgR);
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
          staffCount,
          status,
          label,
          color,
          textColor,
          borderColor,
          doneBlanc: dayDoneBlanc,
          doneRecouche: dayDoneRecouche
        };
      });

    return {
      staffStats,
      totalRooms,
      totalWorkedDays,
      totalShiftHours: Math.round(totalShiftHours),
      globalAvgBlanc,
      globalAvgRecouche,
      globalRoomsPerHour,
      hourlyData: hourlyBins,
      suspectValidations,
      podiums: {
        volume: podiumVolume,
        speed: podiumSpeed,
        efficiency: podiumEfficiency
      },
      trendData,
      adequacyCalendar
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
          <p className="text-sm text-gray-500">Statistiques en temps réel issues du terrain et des archives (basées sur les chambres physiques)</p>
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
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Chambres faites</div>
            <div className="text-3xl font-extrabold text-emerald-600 mt-2">{stats.totalRooms}</div>
            <div className="text-xs text-gray-500 mt-1">Sur la période sélectionnée (chambres physiques)</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent style={{ padding: '20px 24px' }}>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Temps moyen Blanc / Recouche</div>
            <div className="text-2xl font-extrabold text-indigo-600 mt-2">
              {stats.globalAvgBlanc ? `${stats.globalAvgBlanc}m` : '--'} <span className="text-gray-400 text-lg font-normal">/</span> {stats.globalAvgRecouche ? `${stats.globalAvgRecouche}m` : '--'}
            </div>
            <div className="text-xs text-gray-500 mt-1">Hors valeurs aberrantes (&lt;2m, &gt;60m)</div>
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
            <div className="text-xs text-gray-500 mt-1">Chambres nettoyées par heure de shift</div>
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard Podiums Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Podium Volume */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent style={{ padding: '24px' }}>
            <h3 className="text-sm font-bold text-gray-800 mb-4 text-center">🏆 Volume (Total chambres)</h3>
            <div className="flex justify-center items-end space-x-2 h-36 pt-4">
              {/* 2nd Place */}
              {stats.podiums.volume[1] && (
                <div className="flex flex-col items-center w-20">
                  <span className="text-xs text-gray-600 font-medium truncate w-full text-center">{stats.podiums.volume[1].name}</span>
                  <div className="bg-gray-200 w-full h-16 rounded-t-lg flex items-center justify-center font-bold text-gray-600 mt-1">
                    {stats.podiums.volume[1].roomsCleaned}
                  </div>
                  <span className="text-[10px] text-gray-400 font-semibold mt-1">2ème</span>
                </div>
              )}
              {/* 1st Place */}
              {stats.podiums.volume[0] && (
                <div className="flex flex-col items-center w-24">
                  <span className="text-xs text-indigo-600 font-bold truncate w-full text-center">👑 {stats.podiums.volume[0].name}</span>
                  <div className="bg-indigo-500 w-full h-24 rounded-t-lg flex items-center justify-center font-extrabold text-white mt-1 shadow-md">
                    {stats.podiums.volume[0].roomsCleaned}
                  </div>
                  <span className="text-[10px] text-indigo-500 font-bold mt-1">1er</span>
                </div>
              )}
              {/* 3rd Place */}
              {stats.podiums.volume[2] && (
                <div className="flex flex-col items-center w-20">
                  <span className="text-xs text-gray-600 font-medium truncate w-full text-center">{stats.podiums.volume[2].name}</span>
                  <div className="bg-orange-100 w-full h-12 rounded-t-lg flex items-center justify-center font-bold text-orange-700 mt-1">
                    {stats.podiums.volume[2].roomsCleaned}
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
            <h3 className="text-sm font-bold text-gray-800 mb-4 text-center">⚡ Vitesse (Temps moyen)</h3>
            <div className="flex justify-center items-end space-x-2 h-36 pt-4">
              {/* 2nd Place */}
              {stats.podiums.speed[1] && (
                <div className="flex flex-col items-center w-20">
                  <span className="text-xs text-gray-600 font-medium truncate w-full text-center">{stats.podiums.speed[1].name}</span>
                  <div className="bg-gray-200 w-full h-16 rounded-t-lg flex items-center justify-center font-bold text-gray-600 mt-1">
                    {stats.podiums.speed[1].avgSpeed}m
                  </div>
                  <span className="text-[10px] text-gray-400 font-semibold mt-1">2ème</span>
                </div>
              )}
              {/* 1st Place */}
              {stats.podiums.speed[0] && (
                <div className="flex flex-col items-center w-24">
                  <span className="text-xs text-indigo-600 font-bold truncate w-full text-center">👑 {stats.podiums.speed[0].name}</span>
                  <div className="bg-indigo-500 w-full h-24 rounded-t-lg flex items-center justify-center font-extrabold text-white mt-1 shadow-md">
                    {stats.podiums.speed[0].avgSpeed}m
                  </div>
                  <span className="text-[10px] text-indigo-500 font-bold mt-1">1er</span>
                </div>
              )}
              {/* 3rd Place */}
              {stats.podiums.speed[2] && (
                <div className="flex flex-col items-center w-20">
                  <span className="text-xs text-gray-600 font-medium truncate w-full text-center">{stats.podiums.speed[2].name}</span>
                  <div className="bg-orange-100 w-full h-12 rounded-t-lg flex items-center justify-center font-bold text-orange-700 mt-1">
                    {stats.podiums.speed[2].avgSpeed}m
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
            <p className="text-xs text-gray-400 mt-1">Données complètes pour l'intégralité du personnel enregistré (basées sur les chambres physiques)</p>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-400 font-semibold uppercase text-[10px] tracking-wider border-b border-gray-100">
                  <th style={{ padding: '12px 16px' }}>Collaborateur</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Jours travaillés</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Présence (h)</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Chambres faites</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Blanc / Recouche</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Moy. Chambres / jour</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Rendement (ch/h)</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Moy. Blanc</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center' }}>Moy. Recouche</th>
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
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 'bold' }} className="text-emerald-600">{s.roomsCleaned}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontSize: '12px' }} className="text-gray-500">
                      {s.blancCleaned} B / {s.recoucheCleaned} R
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '500' }}>{s.roomsPerDay}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '600' }} className="text-amber-600">{s.roomsPerHour}/h</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '500' }} className="text-indigo-600">
                      {s.avgBlanc !== null ? `${s.avgBlanc} min` : '--'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: '500' }} className="text-amber-600">
                      {s.avgRecouche !== null ? `${s.avgRecouche} min` : '--'}
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

      {/* Visualizations row: Timeline and trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Timeline of release times */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent style={{ padding: '24px' }}>
            <div className="mb-4">
              <h3 className="text-sm font-bold text-gray-800">Timeline de libération des chambres</h3>
              <p className="text-xs text-gray-400 mt-1">Répartition des validations par heure de la journée (basée sur les chambres physiques)</p>
            </div>
            
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.hourlyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="hour" stroke="#6B7280" fontSize={11} />
                  <YAxis stroke="#6B7280" fontSize={11} allowDecimals={false} />
                  <Tooltip formatter={(value) => [`${value} chambres`]} />
                  <Bar dataKey="Chambres libérées" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Completion rate trend */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent style={{ padding: '24px' }}>
            <div className="mb-4">
              <h3 className="text-sm font-bold text-gray-800">Évolution de l'activité quotidienne</h3>
              <p className="text-xs text-gray-400 mt-1">Tendance de complétion et volumes sur la période</p>
            </div>
            
            {stats.trendData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400">
                Données d'activité insuffisantes
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.trendData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0.0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                    <XAxis dataKey="date" stroke="#6B7280" fontSize={11} />
                    <YAxis stroke="#6B7280" fontSize={11} unit="%" domain={[0, 100]} />
                    <Tooltip formatter={(value, name) => [name === 'Taux de complétion (%)' ? `${value}%` : value, name]} />
                    <Area type="monotone" dataKey="Taux de complétion (%)" stroke="#10B981" fillOpacity={1} fill="url(#trendGrad)" strokeWidth={2} />
                  </AreaChart>
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
              Analyse de l'équilibre quotidien entre la charge de travail (temps estimé) et les heures de présence de l'équipe (shift) basées sur les chambres physiques.
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

      {/* Suspect validations alerts block */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardContent style={{ padding: '24px' }}>
          <div className="mb-4">
            <h3 className="text-sm font-bold text-gray-800">⚠️ Alertes de saisies suspectes (Hors réalité)</h3>
            <p className="text-xs text-gray-400 mt-1">Validations ultra-rapides (&lt;2 min) ou oublis de validation (&gt;60 min)</p>
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
                      <td style={{ padding: '8px 16px', textAlign: 'center', fontWeight: 'bold' }} className="text-red-600">{a.durationMin} min</td>
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
