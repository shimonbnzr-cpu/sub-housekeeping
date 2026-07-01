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

// Helper to convert Firestore timestamp or ISO string to Date object
const parseDate = (val) => {
  if (!val) return null;
  if (val.seconds) return new Date(val.seconds * 1000);
  if (val.toDate) return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

export default function StatisticsView({ tasks = [], staff = [], reports = [] }) {
  const { t } = useTranslation();
  const [historyRange, setHistoryRange] = useState(15); // Default to last 15 days

  // --- 1. Compute today's active metrics from 'tasks' ---
  const todayStats = useMemo(() => {
    let doneCount = 0;
    let inProgressCount = 0;
    let dndCount = 0;
    let postponedCount = 0;
    let todoCount = 0;
    
    let totalBlancDuration = 0;
    let blancDoneCount = 0;
    let totalRecoucheDuration = 0;
    let recoucheDoneCount = 0;

    const staffStatsMap = {};

    tasks.forEach(task => {
      // Status breakdown
      if (task.cleaning_status === 'done') {
        doneCount++;
      } else if (task.cleaning_status === 'in_progress') {
        inProgressCount++;
      } else if (task.cleaning_skip_reason === 'dnd') {
        dndCount++;
      } else if (task.cleaning_skip_reason === 'postponed') {
        postponedCount++;
      } else {
        todoCount++;
      }

      // Durations (for completed tasks with valid start & complete times)
      if (task.cleaning_status === 'done') {
        const start = parseDate(task.cleaning_startedAt);
        const end = parseDate(task.cleaning_completedAt);
        
        if (start && end && end > start) {
          const durationMin = (end - start) / (1000 * 60);
          
          if (task.cleaning_type === 'blanc') {
            totalBlancDuration += durationMin;
            blancDoneCount++;
          } else if (task.cleaning_type === 'recouche') {
            totalRecoucheDuration += durationMin;
            recoucheDoneCount++;
          }

          // Staff speed
          if (task.cleaning_assignedTo) {
            if (!staffStatsMap[task.cleaning_assignedTo]) {
              staffStatsMap[task.cleaning_assignedTo] = {
                id: task.cleaning_assignedTo,
                blancDurations: [],
                recoucheDurations: []
              };
            }
            if (task.cleaning_type === 'blanc') {
              staffStatsMap[task.cleaning_assignedTo].blancDurations.push(durationMin);
            } else if (task.cleaning_type === 'recouche') {
              staffStatsMap[task.cleaning_assignedTo].recoucheDurations.push(durationMin);
            }
          }
        }
      }
    });

    const averageBlanc = blancDoneCount > 0 ? Math.round(totalBlancDuration / blancDoneCount) : null;
    const averageRecouche = recoucheDoneCount > 0 ? Math.round(totalRecoucheDuration / recoucheDoneCount) : null;

    // Map staff stats to Recharts compatible array
    const staffData = Object.values(staffStatsMap).map(s => {
      const staffMember = staff.find(st => st.id === s.id);
      const avgBlanc = s.blancDurations.length > 0 
        ? Math.round(s.blancDurations.reduce((a, b) => a + b, 0) / s.blancDurations.length) 
        : 0;
      const avgRecouche = s.recoucheDurations.length > 0 
        ? Math.round(s.recoucheDurations.reduce((a, b) => a + b, 0) / s.recoucheDurations.length) 
        : 0;

      return {
        name: staffMember?.name || 'Inconnu',
        'Blanc (min)': avgBlanc,
        'Recouche (min)': avgRecouche,
        totalCleaned: s.blancDurations.length + s.recoucheDurations.length
      };
    }).filter(s => s.totalCleaned > 0);

    return {
      distribution: [
        { name: 'Terminées', value: doneCount, color: '#10B981' },
        { name: 'En cours', value: inProgressCount, color: '#F59E0B' },
        { name: 'À faire', value: todoCount, color: '#9CA3AF' },
        { name: 'DND', value: dndCount, color: '#3B82F6' },
        { name: 'Reportées', value: postponedCount, color: '#EF4444' }
      ].filter(item => item.value > 0),
      doneCount,
      totalCount: tasks.length,
      averageBlanc,
      averageRecouche,
      staffData
    };
  }, [tasks, staff]);

  // --- 2. Compute historical trend from 'reports' ---
  const historicalData = useMemo(() => {
    if (!reports || reports.length === 0) return [];
    
    // Sort reports chronologically
    return [...reports]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-historyRange) // Keep last N days
      .map(r => {
        const done = r.summary?.done || 0;
        const total = r.summary?.total || 0;
        const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;
        
        // Format date to short string (e.g. "15/06" from "2026-06-15")
        const parts = r.date.split('-');
        const dateShort = parts.length === 3 ? `${parts[2]}/${parts[1]}` : r.date;

        return {
          date: dateShort,
          dateFull: r.date,
          'Complétion (%)': completionRate,
          'Chambres faites': done,
          'Total chambres': total
        };
      });
  }, [reports, historyRange]);

  return (
    <div className="space-y-6 pb-10">
      
      {/* Metrics Top Bar Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-white border shadow-sm">
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-gray-500">Taux de complétion aujourd'hui</div>
            <div className="text-3xl font-bold mt-1 text-emerald-600">
              {todayStats.totalCount > 0 
                ? `${Math.round((todayStats.doneCount / todayStats.totalCount) * 100)}%` 
                : '0%'}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {todayStats.doneCount} / {todayStats.totalCount} chambres faites
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border shadow-sm">
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-gray-500">Moyenne Chambre à blanc</div>
            <div className="text-3xl font-bold mt-1 text-indigo-600">
              {todayStats.averageBlanc !== null ? `${todayStats.averageBlanc} min` : '--'}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Basé sur le travail réel d'aujourd'hui
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border shadow-sm">
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-gray-500">Moyenne Recouche</div>
            <div className="text-3xl font-bold mt-1 text-amber-600">
              {todayStats.averageRecouche !== null ? `${todayStats.averageRecouche} min` : '--'}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Nettoyages réguliers / intermédiaires
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border shadow-sm">
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-gray-500">Femmes de chambre actives</div>
            <div className="text-3xl font-bold mt-1 text-gray-800">
              {staff.filter(s => s.isPresent).length}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Sur {staff.length} personnes enregistrées
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Distribution of Room statuses */}
        <Card className="bg-white border shadow-sm">
          <CardContent className="pt-6">
            <div className="text-base font-semibold text-gray-800 mb-4">Répartition des Chambres (Aujourd'hui)</div>
            {todayStats.distribution.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400">
                Aucune donnée à afficher pour le moment
              </div>
            ) : (
              <div className="flex flex-col md:flex-row items-center justify-around h-64">
                <div className="w-48 h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={todayStats.distribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {todayStats.distribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [`${value} chambres`]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                
                <div className="space-y-2 mt-4 md:mt-0">
                  {todayStats.distribution.map((entry, index) => (
                    <div key={index} className="flex items-center space-x-2 text-sm text-gray-600">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="font-medium text-gray-800">{entry.name} :</span>
                      <span>{entry.value} ({Math.round(entry.value / todayStats.totalCount * 100)}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cleaning Duration per Housekeeper */}
        <Card className="bg-white border shadow-sm">
          <CardContent className="pt-6">
            <div className="text-base font-semibold text-gray-800 mb-4">Temps de nettoyage moyen par Employé</div>
            {todayStats.staffData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400">
                En attente des premières chambres complétées aujourd'hui...
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={todayStats.staffData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                    <XAxis dataKey="name" stroke="#6B7280" fontSize={11} />
                    <YAxis stroke="#6B7280" fontSize={11} unit="m" />
                    <Tooltip formatter={(value) => [`${value} minutes`]} />
                    <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                    <Bar dataKey="Blanc (min)" fill="#6366F1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Recouche (min)" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Historical Completion rate trend chart */}
      <Card className="bg-white border shadow-sm">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4">
            <div className="text-base font-semibold text-gray-800">Évolution du taux de complétion quotidien</div>
            
            <div className="flex space-x-1 mt-2 sm:mt-0 bg-gray-100 p-1 rounded-lg">
              <Button 
                variant={historyRange === 7 ? 'default' : 'ghost'} 
                size="sm" 
                onClick={() => setHistoryRange(7)}
                className="h-8 text-xs"
              >
                7 jours
              </Button>
              <Button 
                variant={historyRange === 15 ? 'default' : 'ghost'} 
                size="sm" 
                onClick={() => setHistoryRange(15)}
                className="h-8 text-xs"
              >
                15 jours
              </Button>
              <Button 
                variant={historyRange === 30 ? 'default' : 'ghost'} 
                size="sm" 
                onClick={() => setHistoryRange(30)}
                className="h-8 text-xs"
              >
                30 jours
              </Button>
            </div>
          </div>

          {historicalData.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-gray-400">
              Aucun rapport historique disponible dans la base de données
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={historicalData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="completionGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="date" stroke="#6B7280" fontSize={11} />
                  <YAxis stroke="#6B7280" fontSize={11} unit="%" domain={[0, 100]} />
                  <Tooltip formatter={(value, name) => [name === 'Complétion (%)' ? `${value}%` : value, name]} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} />
                  <Area 
                    type="monotone" 
                    dataKey="Complétion (%)" 
                    stroke="#10B981" 
                    fillOpacity={1} 
                    fill="url(#completionGrad)" 
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
      
    </div>
  );
}
