import * as XLSX from 'xlsx';
import { ROOMS } from '../data/rooms';

// Parse Medialog export (.xlsx / .xlsm)
export const parseMedialogFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get first sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        // Parse the data
        const tasks = parseMedialogData(jsonData);
        resolve(tasks);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
};

// Parse Medialog data
const parseMedialogData = (data) => {
  const tasks = [];
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  
  // Find header row
  let headerRow = -1;
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i];
    if (row && row.some(cell => cell && String(cell).toLowerCase().includes('chambre'))) {
      headerRow = i;
      break;
    }
  }
  
  if (headerRow === -1) {
    headerRow = 0; // Default to first row
  }
  
  const headers = data[headerRow] || [];
  
  // Find column indices
  const roomCol = headers.findIndex(h => h && (String(h).toLowerCase().includes('chambre') || String(h).toLowerCase().includes('num')));
  const departureCol = headers.findIndex(h => h && String(h).toLowerCase().includes('depart') && !String(h).toLowerCase().includes('retard'));
  const recoucheCol = headers.findIndex(h => h && String(h).toLowerCase().toLowerCase().includes('recouche'));
  const arrivalCol = headers.findIndex(h => h && String(h).toLowerCase().includes('arriv'));
  const departureDateCol = headers.findIndex(h => h && String(h).toLowerCase().includes('depart') && String(h).toLowerCase().includes('date'));
  
  // Parse rows
  for (let i = headerRow + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[roomCol]) continue;
    
    const roomNumber = String(row[roomCol]).trim();
    
    // Find matching room in our config
    const room = ROOMS.find(r => 
      r.number === roomNumber || 
      r.number === roomNumber.replace('-', '') ||
      r.id === roomNumber
    );
    
    if (!room) continue;
    
    // Determine cleaning type
    const isDeparture = row[departureCol] === 'X' || row[departureCol] === 'x';
    const isRecouche = row[recoucheCol] === 'X' || row[recoucheCol] === 'x';
    
    let cleaningType = 'blanc'; // Default: à blanc
    if (isRecouche && !isDeparture) {
      cleaningType = 'recouche';
    }
    
    // Calculate linen change (only for recouche)
    let linenChange = false;
    if (cleaningType === 'recouche') {
      const arrivalDate = row[arrivalCol];
      const departureDate = row[departureDateCol];
      
      if (arrivalDate && departureDate) {
        const arrival = parseExcelDate(arrivalDate);
        const departure = parseExcelDate(departureDate);
        
        if (arrival && departure) {
          const nightsStayed = Math.floor((today - arrival) / (1000 * 60 * 60 * 24));
          const nightsRemaining = Math.floor((departure - today) / (1000 * 60 * 60 * 24));
          
          if (nightsStayed >= 3 && nightsRemaining >= 2) {
            linenChange = true;
          }
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
