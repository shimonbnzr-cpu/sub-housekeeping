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

// Helper to check if a date falls within the selected period
const isInRange = (dateStr, range) => {
  const now = new Date();
  const todayStr = now.toLocaleDateString('fr-CA'); // YYYY-MM-DD
  
  if (range === 'today') return dateStr === todayStr;

  if (range === 'week') {
    // Get Monday of current week
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    
    const itemDate = new Date(dateStr + 'T00:00:00');
    return itemDate >= monday;
  }
  
  if (range === 'month') {
    const itemDate = new Date(dateStr + 'T00:00:00');
    return itemDate.getFullYear() === now.getFullYear() && itemDate.getMonth() === now.getMonth();
  }
  
  if (range === 'year') {
    const itemDate = new Date(dateStr + 'T00:00:00');
    return itemDate.getFullYear() === now.getFullYear();
  }
  
  return true; // 'all'
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

export default function StatisticsView({ tasks = [], staff = [], reports = [] }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState('week'); // 'today' | 'week' | 'month' | 'year' | 'all'

  // --- Core Calculations Engine ---
  const stats = useMemo(() => {
    // 1. Compile today's live summary and merge with historical reports
    const todaySummary = compileTodaySummary(tasks, staff);
    const combinedSummaries = [
      ...reports.filter(r => r.date !== todaySummary.date),
      todaySummary
    ];

    // 2. Filter summaries in the active date period
    const filteredSummaries = combinedSummaries.filter(s => isInRange(s.date, period));

    // 3. Extract and parse all completed tasks details across the period
    const completedTasksList = [];
    const suspectValidations = [];
    
    // Limits to filter out non-real validation duration data
    const MIN_LIMIT_MIN = 2;
    const MAX_LIMIT_MIN = 60;

    filteredSummaries.forEach(s => {
      const snapshot = s.tasksSnapshot || [];
      snapshot.forEach(t => {
        if (t.cleaning_status === 'done') {
          const start = parseDate(t.cleaning_startedAt);
          const end = parseDate(t.cleaning_completedAt);
          
          if (start && end && end > start) {
            const durationMin = (end - start) / (1000 * 60);
            const isOutlier = durationMin < MIN_LIMIT_MIN || durationMin > MAX_LIMIT_MIN;

            completedTasksList.push({
              date: s.date,
              roomId: t.roomId,
              roomNumber: t.roomNumber,
              type: t.cleaning_type,
              staffId: t.cleaning_assignedTo,
              durationMin,
              isOutlier,
              completedAt: end
            });

            // Suspect validation log (Alerts)
            if (isOutlier) {
              const staffName = staff.find(st => st.id === t.cleaning_assignedTo)?.name || 'Inconnu';
              suspectValidations.push({
                date: s.date,
                roomNumber: t.roomNumber,
                staffName,
                durationMin: Math.round(durationMin * 10) / 10,
                time: end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                reason: durationMin < MIN_LIMIT_MIN ? 'Trop rapide (< 2 min)' : 'Oubli de validation (> 60 min)'
              });
            }
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

    // 4. Calculate individual metrics for ALL staff members
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
      
      const validBlancDurations = validStaffTasks.filter(t => t.type === 'blanc').map(t => t.durationMin);
      const validRecoucheDurations = validStaffTasks.filter(t => t.type === 'recouche').map(t => t.durationMin);

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

    // 5. Global aggregated metrics
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

    // 6. Timelines of completions by hour of the day
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

    // 7. Leaderboard Podium sorting
    const podiumVolume = [...staffStats].sort((a, b) => b.roomsCleaned - a.roomsCleaned).slice(0, 3);
    const podiumSpeed = [...staffStats]
      .filter(s => s.avgSpeed !== null)
      .sort((a, b) => a.avgSpeed - b.avgSpeed)
      .slice(0, 3);
    const podiumEfficiency = [...staffStats].sort((a, b) => b.roomsPerHour - a.roomsPerHour).slice(0, 3);

    // 8. Progress trend chart data
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
      trendData
    };
  }, [tasks, staff, reports, period]);

  return (
    <div className="space-y-6 pb-12">
      
      {/* Date Period Picker Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-gray-800">Tableau de bord de performance</h2>
          <p className="text-sm text-gray-500">Statistiques en temps réel issues du terrain et des archives</p>
        </div>
        
        <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-lg">
          {[
            { id: 'today', label: "Aujourd'hui" },
            { id: 'week', label: 'Cette semaine' },
            { id: 'month', label: 'Ce mois' },
            { id: 'year', label: 'Cette année' },
            { id: 'all', label: 'Historique complet' }
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
      </div>

      {/* Primary KPI Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent className="pt-6">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Chambres faites</div>
            <div className="text-3xl font-extrabold text-emerald-600 mt-2">{stats.totalRooms}</div>
            <div className="text-xs text-gray-500 mt-1">Sur la période sélectionnée</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent className="pt-6">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Temps moyen Blanc / Recouche</div>
            <div className="text-2xl font-extrabold text-indigo-600 mt-2">
              {stats.globalAvgBlanc ? `${stats.globalAvgBlanc}m` : '--'} <span className="text-gray-400 text-lg font-normal">/</span> {stats.globalAvgRecouche ? `${stats.globalAvgRecouche}m` : '--'}
            </div>
            <div className="text-xs text-gray-500 mt-1">Hors valeurs aberrantes (&lt;2m, &gt;60m)</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent className="pt-6">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Heures de présence totales</div>
            <div className="text-3xl font-extrabold text-gray-800 mt-2">{stats.totalShiftHours} h</div>
            <div className="text-xs text-gray-500 mt-1">Cumulé sur {stats.totalWorkedDays} jours de travail</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent className="pt-6">
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
          <CardContent className="pt-6">
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
          <CardContent className="pt-6">
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
          <CardContent className="pt-6">
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
        <CardContent className="p-0">
          <div className="p-6 border-b border-gray-100">
            <h3 className="text-base font-bold text-gray-800">Synthèse détaillée par collaborateur</h3>
            <p className="text-xs text-gray-400 mt-1">Données complètes pour l'intégralité du personnel enregistré</p>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-400 font-semibold uppercase text-[10px] tracking-wider border-b border-gray-100">
                  <th className="py-3 px-4">Collaborateur</th>
                  <th className="py-3 px-4 text-center">Jours travaillés</th>
                  <th className="py-3 px-4 text-center">Présence (h)</th>
                  <th className="py-3 px-4 text-center">Chambres faites</th>
                  <th className="py-3 px-4 text-center">Blanc / Recouche</th>
                  <th className="py-3 px-4 text-center">Moy. Chambres / jour</th>
                  <th className="py-3 px-4 text-center">Rendement (ch/h)</th>
                  <th className="py-3 px-4 text-center">Moy. Blanc</th>
                  <th className="py-3 px-4 text-center">Moy. Recouche</th>
                  <th className="py-3 px-4 text-center">Incidents</th>
                  <th className="py-3 px-4 text-center">Saisies Suspectes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stats.staffStats.map((s, index) => (
                  <tr key={index} className="hover:bg-gray-50 text-gray-700">
                    <td className="py-3 px-4 font-semibold text-gray-800">{s.name}</td>
                    <td className="py-3 px-4 text-center font-medium">{s.daysWorked}</td>
                    <td className="py-3 px-4 text-center">{s.totalShiftHours} h</td>
                    <td className="py-3 px-4 text-center font-bold text-emerald-600">{s.roomsCleaned}</td>
                    <td className="py-3 px-4 text-center text-xs text-gray-500">
                      {s.blancCleaned} B / {s.recoucheCleaned} R
                    </td>
                    <td className="py-3 px-4 text-center font-medium">{s.roomsPerDay}</td>
                    <td className="py-3 px-4 text-center font-semibold text-amber-600">{s.roomsPerHour}/h</td>
                    <td className="py-3 px-4 text-center text-indigo-600 font-medium">
                      {s.avgBlanc !== null ? `${s.avgBlanc} min` : '--'}
                    </td>
                    <td className="py-3 px-4 text-center text-amber-600 font-medium">
                      {s.avgRecouche !== null ? `${s.avgRecouche} min` : '--'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={s.incidentRate > 20 ? 'destructive' : 'secondary'} className="text-[10px]">
                        {s.incidentsCount} ({s.incidentRate}%)
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-center">
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
          <CardContent className="pt-6">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-gray-800">Timeline de libération des chambres</h3>
              <p className="text-xs text-gray-400 mt-1">Répartition des validations par heure de la journée</p>
            </div>
            
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.hourlyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="hour" stroke="#6B7280" fontSize={11} />
                  <YAxis stroke="#6B7280" fontSize={11} allowDecimals={false} />
                  <Tooltip formatter={(value) => [`${value} chambres libérées`]} />
                  <Bar dataKey="Chambres libérées" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Completion rate trend */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardContent className="pt-6">
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

      {/* Suspect validations alerts block */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardContent className="pt-6">
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
                    <th className="py-2 px-4">Date</th>
                    <th className="py-2 px-4">Heure</th>
                    <th className="py-2 px-4">Chambre</th>
                    <th className="py-2 px-4">Employé</th>
                    <th className="py-2 px-4 text-center">Durée enregistrée</th>
                    <th className="py-2 px-4">Type d'erreur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {stats.suspectValidations.map((a, idx) => (
                    <tr key={idx} className="hover:bg-red-50 text-gray-700">
                      <td className="py-2 px-4 text-xs font-medium">{a.date}</td>
                      <td className="py-2 px-4 text-xs">{a.time}</td>
                      <td className="py-2 px-4 font-bold text-red-700">Chambre {a.roomNumber}</td>
                      <td className="py-2 px-4 font-medium">{a.staffName}</td>
                      <td className="py-2 px-4 text-center font-bold text-red-600">{a.durationMin} min</td>
                      <td className="py-2 px-4 text-xs text-red-600 font-semibold">{a.reason}</td>
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
