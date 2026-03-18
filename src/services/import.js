import * as XLSX from 'xlsx';
import { ROOMS } from '../data/rooms';

// Parse Medialog export (.xlsx / .xlsm)
export const parseMedialogFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        console.log('Reading file...');
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        console.log('Workbook sheets:', workbook.SheetNames);
        
        // Get first sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        console.log('Worksheet range:', worksheet['!ref']);
        
        // Detect file type from B4
        const typeCell = worksheet['B4'];
        const typeStr = typeCell?.v ? String(typeCell.v).toLowerCase() : '';
        
        let fileType = null;
        if (typeStr.includes("état gouvernante") || typeStr.includes("etat gouvernante")) {
          fileType = 'etat_gouvernante';
        } else if (typeStr.includes("état des chambres") || typeStr.includes("etat des chambres")) {
          fileType = 'etat_chambres';
        }
        
        if (!fileType) {
          reject(new Error("Ce fichier n'est pas reconnu. Veuillez importer un export Medialog valide."));
          return;
        }
        
        // Extract date from B4
        const dateCell = worksheet['B4'];
        let fileDate = new Date();
        if (dateCell && dateCell.v) {
          const dateStr = String(dateCell.v);
          console.log('Date string:', dateStr);
          // Extract date from "L'état gouvernante du mercredi 26 novembre 2025"
          // or "L'état des chambres du mercredi 26 novembre 2025"
          const match = dateStr.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
          if (match) {
            const months = {
              'janvier': 0, 'février': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
              'juillet': 6, 'août': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11,
              'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
              'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11
            };
            const day = parseInt(match[1]);
            const monthName = match[2].toLowerCase();
            const year = parseInt(match[3]);
            const month = months[monthName];
            if (month !== undefined) {
              fileDate = new Date(year, month, day);
              console.log('Parsed file date:', fileDate);
            }
          }
        } else {
          console.warn('Could not extract date from B4, using today');
        }
        
        // Always use today's date for calculations
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Check if file date is different from today (warning)
        const todayStr = today.toISOString().split('T')[0];
        const fileDateStr = fileDate.toISOString().split('T')[0];
        const dateWarning = fileDateStr !== todayStr ? `⚠️ Attention: la date du fichier (${fileDate.toLocaleDateString()}) est différente d'aujourd'hui` : null;
        
        // Parse the worksheet based on detected type
        const tasks = fileType === 'etat_chambres' 
          ? parseEtatChambres(worksheet, today)
          : parseEtatGouvernante(worksheet, today);
        
        console.log('Parsed tasks:', tasks);
        resolve({ tasks, fileDate, dateWarning });
      } catch (error) {
        console.error('Parse error:', error);
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
};

// Get list of all room IDs from import
export const getImportedRoomIds = (tasks) => {
  return new Set(tasks.map(t => t.roomId));
};

// Parse "État des Chambres" format
// - Data starts row 9
// - Column B (index 1): room number
// - Column C (index 2): status as direct text
// - Column F (index 5): arrival date (JS Date object)
// - Column G (index 6): departure date (JS Date object)
const parseEtatChambres = (worksheet, fileDate) => {
  const tasks = [];
  const today = fileDate || new Date();
  today.setHours(0, 0, 0, 0);
  
  console.log('Parsing État des Chambres with date:', today);
  
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'B9:T1000');
  console.log('Range:', range);
  
  // Column indices
  const roomCol = 1;  // B
  const statusCol = 2; // C
  const arrCol = 5;    // F
  const depCol = 6;    // G
  
  // Start from row 9 (index 8)
  for (let rowIdx = 8; rowIdx <= range.e.r; rowIdx++) {
    const roomCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: roomCol })];
    const statusCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: statusCol })];
    const arrCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: arrCol })];
    const depCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: depCol })];
    
    if (!roomCell || !roomCell.v) continue;
    
    const roomNumberRaw = String(roomCell.v).trim();
    console.log('Room:', roomNumberRaw);
    
    // Skip summary rows
    if (roomNumberRaw.includes('chambre') || roomNumberRaw.includes('Total') || roomNumberRaw.includes('H.S.')) {
      continue;
    }
    
    const testNum = parseInt(roomNumberRaw.replace('-', ''));
    if (isNaN(testNum)) continue;
    
    let roomNumber = roomNumberRaw;
    if (roomNumber.includes('-')) {
      roomNumber = roomNumber.replace('-', '_');
    }
    
    const room = ROOMS.find(r => 
      r.number === roomNumberRaw || 
      r.number === roomNumberRaw.replace('-', '') ||
      r.number === roomNumber ||
      r.id === roomNumber ||
      r.id === roomNumberRaw
    );
    
    if (!room) {
      console.log('Room not found:', roomNumberRaw);
      continue;
    }
    
    // Get status value from column C
    const statusValue = statusCell?.v ? String(statusCell.v).trim().toUpperCase() : '';
    
    // Get dates from columns F and G (JS Date objects)
    const arrivalDate = arrCell?.v instanceof Date ? arrCell.v : null;
    const departureDate = depCell?.v instanceof Date ? depCell.v : null;
    
    // Mapping:
    // - "PARTI" / "DEPART" → blanc, todo
    // - "RECOUCHE" → recouche, todo
    // - "DRAPS" → recouche + draps, todo
    // - "LIBRE" / "ARRIVEE" → done
    // - Absent from export → done
    
    let cleaning_status = 'done';
    let cleaning_type = null;
    let cleaning_linenChange = false;
    
    if (statusValue === 'PARTI' || statusValue === 'DEPART') {
      cleaning_status = 'todo';
      cleaning_type = 'blanc';
    } else if (statusValue === 'RECOUCHE') {
      cleaning_status = 'todo';
      cleaning_type = 'recouche';
    } else if (statusValue === 'DRAPS') {
      cleaning_status = 'todo';
      cleaning_type = 'recouche';
      cleaning_linenChange = true;
    } else if (statusValue === 'LIBRE' || statusValue === 'ARRIVEE') {
      cleaning_status = 'done';
      cleaning_type = null;
    }
    // Empty or unrecognized → stays as 'done'
    
    // Calculate linen change for recouche (if arrival/departure dates exist)
    if (cleaning_type === 'recouche' && arrivalDate && departureDate) {
      const arrival = new Date(arrivalDate);
      const departure = new Date(departureDate);
      arrival.setHours(0, 0, 0, 0);
      departure.setHours(0, 0, 0, 0);
      
      const nightsStayed = Math.floor((today - arrival) / (1000 * 60 * 60 * 24));
      const nightsRemaining = Math.floor((departure - today) / (1000 * 60 * 60 * 24));
      
      console.log(`Room ${roomNumber}: arrival=${arrival.toISOString()}, departure=${departure.toISOString()}, nightsStayed=${nightsStayed}, nightsRemaining=${nightsRemaining}`);
      
      // Change linen if >= 3 nights stayed and >= 2 nights remaining
      if (nightsStayed >= 3 && nightsRemaining >= 2) {
        cleaning_linenChange = true;
      }
    }
    
    tasks.push({
      roomId: room.id,
      roomNumber: room.number,
      floor: room.floor,
      cleaning_type,
      cleaning_linenChange,
      cleaning_status,
      cleaning_assignedTo: null,
      cleaning_incident: null,
      cleaning_lateCheckoutTime: null,
      createdAt: new Date().toISOString()
    });
  }
  
  console.log('Total tasks parsed:', tasks.length);
  return tasks;
};

// Parse "État Gouvernante" format (legacy)
const parseEtatGouvernante = (worksheet, fileDate) => {
  const tasks = [];
  const today = fileDate || new Date();
  today.setHours(0, 0, 0, 0);
  
  console.log('Parsing État Gouvernante with date:', today);
  
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'B9:T1000');
  console.log('Range:', range);
  
  // Column indices: B=1, C=2, D=3, E=4
  const roomCol = 1;  // B
  const statusCol = 2; // C
  const depCol = 3;   // D
  const recCol = 4;   // E
  
  // Start from row 9 (index 8)
  for (let rowIdx = 8; rowIdx <= range.e.r; rowIdx++) {
    const roomCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: roomCol })];
    const statusCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: statusCol })];
    const depCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: depCol })];
    const recCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: recCol })];
    
    if (!roomCell || !roomCell.v) continue;
    
    const roomNumberRaw = String(roomCell.v).trim();
    console.log('Room:', roomNumberRaw);
    
    if (roomNumberRaw.includes('chambre') || roomNumberRaw.includes('Total') || roomNumberRaw.includes('H.S.')) {
      continue;
    }
    
    const testNum = parseInt(roomNumberRaw.replace('-', ''));
    if (isNaN(testNum)) continue;
    
    let roomNumber = roomNumberRaw;
    if (roomNumber.includes('-')) {
      roomNumber = roomNumber.replace('-', '_');
    }
    
    const room = ROOMS.find(r => 
      r.number === roomNumberRaw || 
      r.number === roomNumberRaw.replace('-', '') ||
      r.number === roomNumber ||
      r.id === roomNumber ||
      r.id === roomNumberRaw
    );
    
    if (!room) {
      console.log('Room not found:', roomNumberRaw);
      continue;
    }
    
    // Legacy parsing: check columns D (departure) and E (recouche)
    const isDeparture = depCell && (depCell.v === 'X' || depCell.v === 'D');
    const isRecouche = recCell && (recCell.v === 'X' || recCell.v === 'R');
    const isCheckedOut = statusCell && statusCell.v === 'S';
    
    let cleaning_status = 'done';
    let cleaning_type = null;
    let cleaning_linenChange = false;
    
    if (isRecouche) {
      cleaning_status = 'todo';
      cleaning_type = 'recouche';
    } else if (isDeparture) {
      cleaning_status = 'todo';
      cleaning_type = 'blanc';
    } else if (isCheckedOut) {
      cleaning_status = 'todo';
      cleaning_type = 'blanc';
    } else {
      cleaning_status = 'done';
      cleaning_type = null;
    }
    
    tasks.push({
      roomId: room.id,
      roomNumber: room.number,
      floor: room.floor,
      cleaning_type,
      cleaning_linenChange,
      cleaning_status,
      cleaning_assignedTo: null,
      cleaning_incident: null,
      cleaning_lateCheckoutTime: null,
      createdAt: new Date().toISOString()
    });
  }
  
  console.log('Total tasks parsed:', tasks.length);
  return tasks;
};

// Get tasks that are NOT in the import (these are clean/not occupied)
export const getCleanRooms = (importedTasks) => {
  const importedRoomIds = new Set(importedTasks.map(t => t.roomId));
  return ROOMS.filter(r => !importedRoomIds.has(r.id));
};
