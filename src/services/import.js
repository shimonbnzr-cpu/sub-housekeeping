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
        const tasks = parseMedialogData(worksheet, today, fileType);
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

// Parse Medialog data based on file type
const parseMedialogData = (worksheet, fileDate, fileType) => {
  const tasks = [];
  const today = fileDate || new Date();
  today.setHours(0, 0, 0, 0);
  
  console.log('Parsing worksheet with date:', today, 'type:', fileType);
  
  // Parse rows from row 9 onwards (Excel row 9 = data starts here)
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'B9:T1000');
  console.log('Range:', range);
  
  // Column indices: B=1, C=2, D=3, E=4
  const roomCol = 1;  // B
  const statusCol = 2; // C - Status column
  
  // Start from row 9 (index 8)
  for (let rowIdx = 8; rowIdx <= range.e.r; rowIdx++) {
    // Get cell values directly from worksheet
    const roomCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: roomCol })];
    const statusCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: statusCol })];
    
    if (!roomCell || !roomCell.v) continue;
    
    // Get room number
    const roomNumberRaw = String(roomCell.v).trim();
    console.log('Room:', roomNumberRaw);
    
    // Skip summary rows
    if (roomNumberRaw.includes('chambre') || roomNumberRaw.includes('Total') || roomNumberRaw.includes('H.S.')) {
      continue;
    }
    
    // Check if it's a number or valid room
    const testNum = parseInt(roomNumberRaw.replace('-', ''));
    if (isNaN(testNum)) continue;
    
    // Find matching room in our config
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
    
    // Mapping based on status column (column C):
    // - "PARTI" → cleaning_type: "blanc", cleaning_status: "todo"
    // - "DEPART" → cleaning_type: "blanc", cleaning_status: "todo"
    // - "RECOUCHE" → cleaning_type: "recouche", cleaning_status: "todo"
    // - "DRAPS" → cleaning_type: "recouche", cleaning_status: "todo", cleaning_linenChange: true
    // - "LIBRE" → cleaning_status: "done"
    // - "ARRIVEE" → cleaning_status: "done"
    // - Empty/not in list → cleaning_status: "done" (absent from export = already clean)
    
    let cleaning_status = 'done'; // Default: done (absent from export = clean)
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
    // Empty or unrecognized → stays as 'done' (absent from export)
    
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

// Parse Excel date
const parseExcelDate = (dateValue) => {
  if (!dateValue) return null;
  
  // If it's already a Date
  if (dateValue instanceof Date) {
    return dateValue;
  }
  
  // If it's a serial number (Excel date)
  if (typeof dateValue === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + dateValue * 24 * 60 * 60 * 1000);
  }
  
  // If it's a string, try to parse
  if (typeof dateValue === 'string') {
    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  
  return null;
};

// Get tasks that are NOT in the import (these are clean/not occupied)
export const getCleanRooms = (importedTasks) => {
  const importedRoomIds = new Set(importedTasks.map(t => t.roomId));
  return ROOMS.filter(r => !importedRoomIds.has(r.id));
};
