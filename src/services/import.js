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
        
        // Extract date from B4
        const dateCell = worksheet['B4'];
        let fileDate = new Date();
        if (dateCell && dateCell.v) {
          const dateStr = String(dateCell.v);
          console.log('Date string:', dateStr);
          // Extract date from "L'état gouvernante du mercredi 26 novembre 2025"
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
        
        // Parse the worksheet directly
        const tasks = parseMedialogData(worksheet, fileDate);
        console.log('Parsed tasks:', tasks);
        resolve({ tasks, fileDate });
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

// Parse Medialog data - Using worksheet cell references directly
const parseMedialogData = (worksheet, fileDate) => {
  const tasks = [];
  const today = fileDate || new Date();
  today.setHours(0, 0, 0, 0);
  
  console.log('Parsing worksheet with date:', today);
  
  // Parse rows from row 9 onwards (Excel row 9 = data starts here)
  // We need to iterate through the worksheet range
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'B9:T1000');
  console.log('Range:', range);
  
  // Column indices: B=1, D=3, E=4, K=10, L=11
  const roomCol = 1;  // B
  const depCol = 3;   // D
  const recCol = 4;   // E
  const arrCol = 10;  // K
  const depDateCol = 11; // L
  
  // Start from row 9 (index 8)
  for (let rowIdx = 8; rowIdx <= range.e.r; rowIdx++) {
    // Get cell values directly from worksheet
    const roomCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: roomCol })];
    const depCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: depCol })];
    const recCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: recCol })];
    const arrCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: arrCol })];
    const depDateCell = worksheet[XLSX.utils.encode_cell({ r: rowIdx, c: depDateCol })];
    
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
    
    // Check departure (D column) - "X" means departure
    const isDeparture = depCell && (depCell.v === 'X' || depCell.v === 'D');
    // Check recouche (E column) - "X" or "R" means recouche
    const isRecouche = recCell && (recCell.v === 'X' || recCell.v === 'R');
    
    // Determine cleaning type
    let cleaningType = 'blanc';
    if (isRecouche && !isDeparture) {
      cleaningType = 'recouche';
    } else if (isDeparture) {
      cleaningType = 'blanc';
    }
    
    // Calculate linen change for recouche
    let linenChange = false;
    if (cleaningType === 'recouche' && arrCell && depDateCell) {
      const arrival = parseExcelDate(arrCell.v);
      const departure = parseExcelDate(depDateCell.v);
      
      if (arrival && departure) {
        arrival.setHours(0, 0, 0, 0);
        departure.setHours(0, 0, 0, 0);
        
        const nightsStayed = Math.floor((today - arrival) / (1000 * 60 * 60 * 24));
        const nightsRemaining = Math.floor((departure - today) / (1000 * 60 * 60 * 24));
        
        console.log(`Room ${roomNumber}: arrival=${arrival.toISOString()}, departure=${departure.toISOString()}, nightsStayed=${nightsStayed}, nightsRemaining=${nightsRemaining}`);
        
        if (nightsStayed >= 3 && nightsRemaining >= 2) {
          linenChange = true;
        }
      }
    }
    
    tasks.push({
      roomId: room.id,
      roomNumber: room.number,
      floor: room.floor,
      type: cleaningType,
      linenChange,
      status: 'todo',
      assignedTo: null,
      incident: null,
      lateCheckoutTime: null,
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
