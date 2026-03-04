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
  }
`;

// Generate print HTML
export const printSheets = (staffList, tasks) => {
  // Filter present staff
  const presentStaff = staffList.filter(s => s.presentToday);
  
  const sheets = presentStaff.map(staff => {
    const staffTasks = tasks
      .filter(t => t.assignedTo === staff.id && t.status !== 'done')
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
              <td>${t.type === 'recouche' ? 'Recouche' : 'À blanc'} ${t.linenChange ? '🛏' : ''}</td>
              <td>${t.lateCheckoutTime ? '🕐 Late ' + t.lateCheckoutTime : ''}</td>
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
