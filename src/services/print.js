// Print Styles
const printStyles = `
  @media print {
    body * { visibility: hidden; }
    #print-container, #print-container * { visibility: visible; }
    #print-container { position: absolute; top: 0; left: 0; width: 100%; }
    
    .sheet {
      page-break-after: always;
      padding: 20mm;
      font-family: Arial, sans-serif;
      color: black;
      background: white;
    }
    .sheet:last-child { page-break-after: avoid; }
    
    .sheet-header { margin-bottom: 16px; border-bottom: 2px solid black; padding-bottom: 8px; }
    .sheet-header h1 { font-size: 14px; margin: 0; }
    .sheet-header h2 { font-size: 20px; margin: 4px 0; }
    .sheet-header p { font-size: 12px; margin: 0; color: #444; }
    
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { background: #f0f0f0; font-size: 11px; 
      text-transform: uppercase; padding: 6px 8px; 
      border: 1px solid #ccc; text-align: left; }
    td { padding: 8px; border: 1px solid #ddd; font-size: 13px; }
    tr:nth-child(even) { background: #fafafa; }
    
    .sheet-footer { margin-top: 12px; font-size: 12px; 
      font-weight: bold; text-align: right; }
    .blanc-label { color: #DC2626; font-weight: 600; }
  }
`;

// Generate print HTML
export const printSheets = (staffList, tasks) => {
  // Filter present staff
  const presentStaff = staffList.filter(s => s.presentToday);
  
  const sheets = presentStaff.map(staff => {
    const staffTasks = tasks
      .filter(t => t.cleaning_assignedTo === staff.id && t.cleaning_status !== 'done' && t.cleaning_status !== 'ready')
      .sort((a, b) => {
        const numA = parseInt(a.roomNumber?.toString().replace(/-.*/, '') || '0');
        const numB = parseInt(b.roomNumber?.toString().replace(/-.*/, '') || '0');
        return numA - numB;
      });
    return { staff, tasks: staffTasks };
  });

  const html = sheets.map(({ staff, tasks }) => `
    <div class="sheet">
      <div class="sheet-header">
        <h1>Hôtel SUB — Gouvernante</h1>
        <h2>${staff.name}</h2>
        <p>${new Date().toLocaleDateString('fr-FR', { 
          weekday: 'long', year: 'numeric', 
          month: 'long', day: 'numeric' 
        })}</p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Chambre</th>
            <th>Type</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${tasks.map(t => `
            <tr>
              <td><strong>${t.roomNumber}</strong></td>
              <td>${t.cleaning_type === 'recouche' ? 'Recouche' : '<span style="color:red !important;font-weight:bold !important;">À blanc</span>'} ${t.cleaning_linenChange ? '🛏' : ''}</td>
              <td>${t.cleaning_lateCheckoutTime ? '🕐 Late ' + t.cleaning_lateCheckoutTime : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="sheet-footer">
        Total : ${tasks.length} chambre(s)
      </div>
    </div>
  `).join('');

  return html;
};

// Handle print function
export const handlePrint = (staffList, tasks) => {
  // Inject print styles
  let styleEl = document.getElementById('print-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'print-styles';
    document.head.appendChild(styleEl);
  }
  styleEl.innerHTML = printStyles;

  // Inject print content
  let container = document.getElementById('print-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'print-container';
    document.body.appendChild(container);
  }
  container.innerHTML = printSheets(staffList, tasks);

  // Trigger print
  window.print();

  // Clean up after print
  setTimeout(() => {
    styleEl?.remove();
    container.innerHTML = '';
  }, 100);
};

// Print Report function
export const printReport = (report) => {
  const formatTime = (ts) => {
    if (!ts) return '-';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (d) => {
    if (!d) return '-';
    const date = d.toDate ? d.toDate() : new Date(d);
    return date.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };

  const sortedTasks = (report.tasksSnapshot || []).sort((a, b) => {
    const numA = parseInt(a.roomNumber?.toString().replace(/-.*/, '') || '0');
    const numB = parseInt(b.roomNumber?.toString().replace(/-.*/, '') || '0');
    return numA - numB;
  });

  const html = `
    <div class="sheet">
      <div class="sheet-header">
        <h1>Hôtel SUB — Rapport journalier</h1>
        <h2>${formatDate(report.date)}</h2>
      </div>

      <!-- Résumé -->
      <div style="margin-bottom: 20px;">
        <h3 style="font-size: 14px; border-bottom: 1px solid #000; margin-bottom: 8px;">Résumé</h3>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 12px;">
          <div><strong>Terminées:</strong> ${report.summary?.done || 0}/${report.summary?.total || 0}</div>
          <div><strong>DND:</strong> ${report.summary?.dnd || 0}</div>
          <div><strong>Reportées:</strong> ${report.summary?.postponed || 0}</div>
          <div><strong>Non faites:</strong> ${report.summary?.notDone || 0}</div>
          <div><strong>Première started:</strong> ${formatTime(report.summary?.firstStartedAt)}</div>
          <div><strong>Dernière terminée:</strong> ${formatTime(report.summary?.lastCompletedAt)}</div>
        </div>
      </div>

      <!-- Par femme de chambre -->
      <div style="margin-bottom: 20px;">
        <h3 style="font-size: 14px; border-bottom: 1px solid #000; margin-bottom: 8px;">Par femme de chambre</h3>
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Ch.</th>
              <th>Blanc</th>
              <th>Recouche</th>
              <th>Rep.</th>
              <th>DND</th>
              <th>Inc.</th>
              <th>Début</th>
              <th>Fin</th>
            </tr>
          </thead>
          <tbody>
            ${(report.byStaff || []).map(s => `
              <tr>
                <td>${s.name}</td>
                <td>${s.done || 0}</td>
                <td>${s.blanc || 0}</td>
                <td>${s.recouche || 0}</td>
                <td>${s.postponed || 0}</td>
                <td>${s.dnd || 0}</td>
                <td>${s.incidents || 0}</td>
                <td>${s.shift_start || '-'}</td>
                <td>${s.shift_end || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Incidents -->
      ${(report.incidents || []).length > 0 ? `
        <div style="margin-bottom: 20px;">
          <h3 style="font-size: 14px; border-bottom: 1px solid #000; margin-bottom: 8px;">Incidents (${report.incidents.length})</h3>
          <ul style="font-size: 12px;">
            ${report.incidents.map(i => `<li>${i.roomNumber}: ${i.description || 'Problème'}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <!-- Chambres reportées -->
      ${(report.postponedRooms || []).length > 0 ? `
        <div style="margin-bottom: 20px;">
          <h3 style="font-size: 14px; border-bottom: 1px solid #000; margin-bottom: 8px;">Chambres reportées (${report.postponedRooms.length})</h3>
          <p style="font-size: 12px;">${report.postponedRooms.map(r => r.roomNumber).join(', ')}</p>
        </div>
      ` : ''}

      <!-- Détail par chambre -->
      <div>
        <h3 style="font-size: 14px; border-bottom: 1px solid #000; margin-bottom: 8px;">Détail par chambre</h3>
        <table>
          <thead>
            <tr>
              <th>Ch.</th>
              <th>Assignée</th>
              <th>Type</th>
              <th>Statut</th>
              <th>Début</th>
              <th>Fin</th>
            </tr>
          </thead>
          <tbody>
            ${sortedTasks.map(t => `
              <tr>
                <td><strong>${t.roomNumber}</strong></td>
                <td>${t.assignedTo || '-'}</td>
                <td>${t.type === 'recouche' ? 'Recouche' : 'Blanc'}</td>
                <td>${t.status === 'done' ? 'Terminée' : 
                t.status === 'in_progress' ? 'En cours' : 
                t.status === 'todo' ? 'À faire' : 
                t.status === 'dnd' ? 'DND' : 
                t.status === 'postponed' ? 'Reportée' : 
                t.status === 'freed' ? 'Libérée' : 
                t.status === 'late_checkout' ? 'Late checkout' : 
                t.status}</td>
                <td>${t.cleaning_startedAt ? formatTime(t.cleaning_startedAt) : '-'}</td>
                <td>${t.cleaning_completedAt ? formatTime(t.cleaning_completedAt) : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Inject print styles
  let styleEl = document.getElementById('print-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'print-styles';
    document.head.appendChild(styleEl);
  }
  styleEl.innerHTML = printStyles;

  // Inject print content
  let container = document.getElementById('print-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'print-container';
    document.body.appendChild(container);
  }
  container.innerHTML = html;

  // Trigger print
  window.print();

  // Clean up after print
  setTimeout(() => {
    styleEl?.remove();
    container.innerHTML = '';
  }, 100);
};
