import { db } from '../firebase';
import { ROOMS } from '../data/rooms';
import { 
  collection, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot,
  query,
  serverTimestamp,
  getDocs
} from 'firebase/firestore';

// Get today's date as YYYY-MM-DD string
export const getTodayKey = () => {
  return new Date().toISOString().split('T')[0];
};

// Collection references
const getTasksCollection = (date) => collection(db, `daily_planning/${date}/tasks`);
const getStaffCollection = () => collection(db, 'staff');

// Subscribe to today's tasks (realtime)
export const subscribeToTasks = (callback) => {
  const date = getTodayKey();
  const q = query(getTasksCollection(date));

  return onSnapshot(q, (snapshot) => {
    const tasks = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    callback(tasks);
  });
};

// Subscribe to staff (realtime)
export const subscribeToStaff = (callback) => {
  return onSnapshot(getStaffCollection(), (snapshot) => {
    const staff = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    callback(staff);
  });
};

// Create or update a task
export const setTask = async (taskData) => {
  const date = getTodayKey();
  const taskRef = doc(getTasksCollection(date), taskData.roomId);
  
  await setDoc(taskRef, {
    ...taskData,
    updatedAt: serverTimestamp()
  }, { merge: true });
};

// Batch create tasks (for import)
export const batchSetTasks = async (tasksData) => {
  const date = getTodayKey();
  
  for (const taskData of tasksData) {
    const taskRef = doc(getTasksCollection(date), taskData.roomId);
    await setDoc(taskRef, {
      ...taskData,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
};

// Update task status
export const updateTaskStatus = async (roomId, status, additionalData = {}) => {
  const date = getTodayKey();
  const taskRef = doc(getTasksCollection(date), roomId);
  
  const updates = {
    status,
    updatedAt: serverTimestamp()
  };
  
  // Add timestamps based on status
  if (status === 'in_progress' && !additionalData.cleaning_startedAt) {
    updates.cleaning_startedAt = serverTimestamp();
  } else if (status === 'done' && !additionalData.cleaning_completedAt) {
    updates.cleaning_completedAt = serverTimestamp();
  }
  
  await updateDoc(taskRef, { ...updates, ...additionalData });
};

// Assign task to staff
export const assignTask = async (roomId, staffId) => {
  const date = getTodayKey();
  const taskRef = doc(getTasksCollection(date), roomId);
  
  await updateDoc(taskRef, {
    assignedTo: staffId,
    updatedAt: serverTimestamp()
  });
};

// Assign multiple tasks
export const batchAssignTasks = async (roomIds, staffId) => {
  const date = getTodayKey();
  
  for (const roomId of roomIds) {
    const taskRef = doc(getTasksCollection(date), roomId);
    await updateDoc(taskRef, {
      assignedTo: staffId,
      updatedAt: serverTimestamp()
    });
  }
};

// Auto-assign rooms evenly among present staff
export const autoAssignTasks = async (tasks, staff) => {
  const presentStaff = staff.filter(s => s.presentToday);
  if (presentStaff.length === 0) return;
  
  const numStaff = presentStaff.length;
  
  // Floor order
  const FLOOR_ORDER = ['RDC', '1er', '2e', '3e', '4e', '5e'];
  
  // Get all rooms with their tasks - only todo/freed/late_checkout status (exclude done, in_progress, dnd, postponed)
  const allRooms = [];
  const dormMap = {}; // Map dorm parent -> children
  
  for (const room of ROOMS) {
    const task = tasks.find(t => t.roomId === room.id);
    // Include rooms with todo, freed, or late_checkout status (exclude done, in_progress, dnd, postponed)
    if (task && ['todo', 'freed', 'late_checkout'].includes(task.status)) {
      if (room.type === 'dorm') {
        // Group dorm beds under parent
        const parentId = room.number.split('-')[0];
        if (!dormMap[parentId]) {
          dormMap[parentId] = [];
        }
        dormMap[parentId].push({ ...room, task });
      } else {
        allRooms.push({ ...room, task });
      }
    }
  }
  
  // Add dorm parents as single units
  for (const parentId of Object.keys(dormMap)) {
    const beds = dormMap[parentId];
    const firstBed = beds[0];
    allRooms.push({
      ...firstBed,
      id: parentId,
      number: parentId,
      isDorm: true,
      beds: beds
    });
  }
  
  // Sort by floor then room number
  allRooms.sort((a, b) => {
    const floorA = FLOOR_ORDER.indexOf(a.floor);
    const floorB = FLOOR_ORDER.indexOf(b.floor);
    if (floorA !== floorB) return floorA - floorB;
    const numA = parseInt(a.number.toString().replace(/-.*/, ''));
    const numB = parseInt(b.number.toString().replace(/-.*/, ''));
    return numA - numB;
  });
  
  // Count blanc and recouche (dorms count as 1)
  const blancRooms = allRooms.filter(r => r.task.type === 'blanc');
  const recoucheRooms = allRooms.filter(r => r.task.type === 'recouche');
  const totalBlanc = blancRooms.length;
  const totalRooms = allRooms.length;
  
  // Calculate quotas
  const blancQuota = Math.ceil(totalBlanc / numStaff);
  const totalQuota = Math.ceil(totalRooms / numStaff);
  
  // Rotate starting person based on date
  const today = new Date();
  const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
  const startOffset = dayOfYear % numStaff;
  
  // Rotate staff
  const rotatedStaff = [
    ...presentStaff.slice(startOffset),
    ...presentStaff.slice(0, startOffset)
  ];
  
  // Initialize staff
  const staffAssignments = rotatedStaff.map((s, i) => ({
    id: s.id,
    name: s.name,
    rooms: [],
    floors: new Set(),
    blancCount: 0
  }));
  
  // Helper to get floors for a person's current block
  const getCurrentBlockFloors = (staffIdx) => {
    const floors = new Set();
    for (const r of staffAssignments[staffIdx].rooms) {
      floors.add(r.floor);
    }
    return floors;
  };
  
  // Step 1: Assign blanc rooms first, respecting floor blocks
  let staffIdx = 0;
  for (const room of blancRooms) {
    let found = false;
    for (let attempt = 0; attempt < numStaff; attempt++) {
      const testIdx = (staffIdx + attempt) % numStaff;
      const staff = staffAssignments[testIdx];
      
      if (staff.blancCount >= blancQuota) continue;
      
      const currentFloors = getCurrentBlockFloors(testIdx);
      if (currentFloors.size >= 3 && !currentFloors.has(room.floor)) {
        continue;
      }
      
      staff.rooms.push(room);
      staff.floors.add(room.floor);
      staff.blancCount++;
      staffIdx = testIdx;
      found = true;
      break;
    }
    
    if (!found) {
      staffAssignments[staffIdx].rooms.push(room);
      staffAssignments[staffIdx].floors.add(room.floor);
      staffAssignments[staffIdx].blancCount++;
    }
  }
  
  // Step 2: Fill remaining quota with recouche rooms
  staffIdx = 0;
  for (const room of recoucheRooms) {
    let found = false;
    for (let attempt = 0; attempt < numStaff; attempt++) {
      const testIdx = (staffIdx + attempt) % numStaff;
      const staff = staffAssignments[testIdx];
      
      if (staff.rooms.length >= totalQuota) continue;
      
      const currentFloors = getCurrentBlockFloors(testIdx);
      if (currentFloors.size >= 4 && !currentFloors.has(room.floor)) {
        continue;
      }
      
      staff.rooms.push(room);
      staff.floors.add(room.floor);
      staffIdx = testIdx;
      found = true;
      break;
    }
    
    if (!found) {
      staffAssignments[staffIdx].rooms.push(room);
      staffAssignments[staffIdx].floors.add(room.floor);
    }
  }
  
  // Apply assignments - for dorms, assign all beds
  for (const staffMember of staffAssignments) {
    for (const room of staffMember.rooms) {
      if (room.isDorm && room.beds) {
        // Assign all beds in the dorm
        for (const bed of room.beds) {
          await assignTask(bed.task.roomId, staffMember.id);
        }
      } else {
        await assignTask(room.task.roomId, staffMember.id);
      }
    }
  }
};

// Reset all tasks to todo and unassign
export const resetAllTasks = async (tasks) => {
  const date = getTodayKey();
  
  // Only reset tasks that are in 'todo' status (not done, in_progress, dnd, or postponed)
  const tasksToReset = tasks.filter(t => t.status === 'todo' || t.status === 'freed');
  
  // Ensure all rooms exist first
  await ensureAllRoomsHaveTasks();
  
  // Then reset only the tasks that are in todo status
  for (const task of tasksToReset) {
    const taskRef = doc(getTasksCollection(date), task.roomId);
    await updateDoc(taskRef, {
      type: 'blanc',
      assignedTo: null,
      incident: null,
      linenChange: false,
      lateCheckoutTime: null,
      cleaning_startedAt: null,
      cleaning_completedAt: null,
      updatedAt: serverTimestamp()
    });
  }
};

// Reset type to blanc, keep status
export const resetTaskTypes = async (tasks) => {
  const date = getTodayKey();
  
  for (const task of tasks) {
    const taskRef = doc(getTasksCollection(date), task.roomId);
    await updateDoc(taskRef, {
      type: 'blanc',
      linenChange: false,
      updatedAt: serverTimestamp()
    });
  }
};

// Ensure all rooms have a task (create if missing)
export const ensureAllRoomsHaveTasks = async () => {
  const date = getTodayKey();
  const snapshot = await getDocs(getTasksCollection(date));
  const existingIds = new Set(snapshot.docs.map(d => d.id));
  
  for (const room of ROOMS) {
    if (!existingIds.has(room.id)) {
      const taskRef = doc(getTasksCollection(date), room.id);
      await setDoc(taskRef, {
        roomId: room.id,
        roomNumber: room.number,
        floor: room.floor,
        type: 'blanc',
        status: 'todo',
        assignedTo: null,
        incident: null,
        linenChange: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
  }
};

// Delete a task (reset room)
export const deleteTask = async (roomId) => {
  const date = getTodayKey();
  const taskRef = doc(getTasksCollection(date), roomId);
  await deleteDoc(taskRef);
};

// Delete all tasks for today (reset)
export const resetDailyPlanning = async () => {
  const date = getTodayKey();
  const snapshot = await getDocs(getTasksCollection(date));
  
  // Get all tasks and staff before deleting
  const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const staffSnapshot = await getDocs(getStaffCollection());
  const staff = staffSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  // Generate and save report before reset
  await generateAndSaveReport(tasks, staff);
  
  // Delete all tasks for today
  for (const d of snapshot.docs) {
    await deleteDoc(d.ref);
  }
};

// Add incident to task
export const addIncident = async (roomId, incident) => {
  const date = getTodayKey();
  const taskRef = doc(getTasksCollection(date), roomId);
  
  await updateDoc(taskRef, {
    incident: incident,
    incidentAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
};

// Update staff presence
export const updateStaffPresence = async (staffId, presentToday) => {
  const staffRef = doc(getStaffCollection(), staffId);
  await updateDoc(staffRef, {
    presentToday,
    updatedAt: serverTimestamp()
  });
};

// Update staff shift times
export const updateStaffShift = async (staffId, shiftStart, shiftEnd) => {
  const staffRef = doc(getStaffCollection(), staffId);
  await updateDoc(staffRef, {
    shift_start: shiftStart || null,
    shift_end: shiftEnd || null,
    updatedAt: serverTimestamp()
  });
};

// Create or update staff member
export const setStaff = async (staffData) => {
  const staffRef = doc(getStaffCollection(), staffData.id);
  await setDoc(staffRef, {
    ...staffData,
    updatedAt: serverTimestamp()
  }, { merge: true });
};

// Delete staff member
export const deleteStaff = async (staffId) => {
  const staffRef = doc(getStaffCollection(), staffId);
  await deleteDoc(staffRef);
};

// Initialize default staff if missing
export const initializeDefaultStaff = async (defaultStaff) => {
  console.log('[Firestore] Initializing staff...');
  const snapshot = await getDocs(getStaffCollection());
  const existingIds = new Set(snapshot.docs.map(d => d.id));
  
  // Add any missing default staff
  for (const member of defaultStaff) {
    if (!existingIds.has(member.id)) {
      const staffRef = doc(getStaffCollection(), member.id);
      await setDoc(staffRef, {
        ...member,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      console.log('[Firestore] Created member:', member.id);
    }
  }
};

// Set late checkout
export const setLateCheckout = async (roomId, time) => {
  const date = getTodayKey();
  const taskRef = doc(getTasksCollection(date), roomId);
  
  await updateDoc(taskRef, {
    status: 'late_checkout',
    lateCheckoutTime: time,
    updatedAt: serverTimestamp()
  });
};

// Clear late checkout
export const clearLateCheckout = async (roomId) => {
  const date = getTodayKey();
  const taskRef = doc(getTasksCollection(date), roomId);
  
  await updateDoc(taskRef, {
    status: 'todo',
    lateCheckoutTime: null,
    updatedAt: serverTimestamp()
  });
};

// ============================================
// REPORTS - Housekeeping Reports
// ============================================

const getReportsCollection = () => collection(db, 'housekeeping_reports');

// Subscribe to all reports (sorted by date descending)
export const subscribeToReports = (callback) => {
  const q = query(getReportsCollection());
  
  return onSnapshot(q, (snapshot) => {
    const reports = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    // Sort by date descending
    reports.sort((a, b) => new Date(b.date) - new Date(a.date));
    callback(reports);
  });
};

// Get a single report by date
export const getReportByDate = async (date) => {
  const reportRef = doc(getReportsCollection(), date);
  // Note: For realtime, use onSnapshot instead
  return null; // Use subscribeToReport for realtime
};

// Subscribe to a specific report
export const subscribeToReport = (date, callback) => {
  const reportRef = doc(getReportsCollection(), date);
  
  return onSnapshot(reportRef, (snapshot) => {
    if (snapshot.exists()) {
      callback({ id: snapshot.id, ...snapshot.data() });
    } else {
      callback(null);
    }
  });
};

// Generate and save report for today (called before reset)
export const generateAndSaveReport = async (tasks, staff) => {
  const date = getTodayKey();
  
  // Calculate summary
  const doneTasks = tasks.filter(t => t.status === 'done');
  const dndTasks = tasks.filter(t => t.status === 'dnd');
  const postponedTasks = tasks.filter(t => t.status === 'postponed');
  const notDoneTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'dnd' && t.status !== 'postponed');
  
  // Get timestamps
  const startedTasks = tasks.filter(t => t.cleaning_startedAt);
  const completedTasks = tasks.filter(t => t.cleaning_completedAt);
  
  // Helper to convert Firestore timestamp to Date
  const toDate = (val) => {
    if (!val) return null;
    if (val.toDate) return val.toDate(); // Firestore Timestamp
    if (val instanceof Date) return val;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  };
  
  const firstStartedAt = startedTasks.length > 0 
    ? new Date(Math.min(...startedTasks.map(t => toDate(t.cleaning_startedAt)?.getTime() || Infinity).filter(v => v !== Infinity && v !== null)))
    : null;
    
  const lastCompletedAt = completedTasks.length > 0 
    ? new Date(Math.max(...completedTasks.map(t => toDate(t.cleaning_completedAt)?.getTime() || 0).filter(v => v !== null)))
    : null;
  
  // By staff
  const presentStaff = staff.filter(s => s.presentToday);
  const byStaff = presentStaff.map(s => {
    const staffTasks = tasks.filter(t => t.assignedTo === s.id);
    const staffDone = staffTasks.filter(t => t.status === 'done');
    const staffBlanc = staffDone.filter(t => t.type === 'blanc');
    const staffRecouche = staffDone.filter(t => t.type === 'recouche');
    const staffIncidents = staffTasks.filter(t => t.incident && t.incident !== 'Ne pas déranger');
    
    return {
      name: s.name,
      done: staffDone.length,
      blanc: staffBlanc.length,
      recouche: staffRecouche.length,
      incidents: staffIncidents.length,
      postponed: tasks.filter(t => t.assignedTo === s.id && t.status === 'postponed').length,
      dnd: tasks.filter(t => t.assignedTo === s.id && t.status === 'dnd').length,
      shift_start: s.shift_start || null,
      shift_end: s.shift_end || null
    };
  });
  
  // Incidents with staff name
  const incidents = tasks
    .filter(t => t.incident && t.incident !== 'Ne pas déranger')
    .map(t => {
      const assignedStaff = staff.find(s => s.id === t.assignedTo);
      return {
        roomNumber: t.roomNumber,
        text: t.incident,
        assignedTo: assignedStaff?.name || '-'
      };
    });
  
  // Postponed rooms with staff name
  const postponed = postponedTasks.map(t => {
    const assignedStaff = staff.find(s => s.id === t.assignedTo);
    return {
      roomNumber: t.roomNumber,
      type: t.type,
      assignedTo: assignedStaff?.name || '-'
    };
  });
  
  // DND rooms with staff name
  const dndList = dndTasks.map(t => {
    const assignedStaff = staff.find(s => s.id === t.assignedTo);
    return {
      roomNumber: t.roomNumber,
      type: t.type,
      assignedTo: assignedStaff?.name || '-',
      incident: t.incident || null
    };
  });
  
  const report = {
    date,
    summary: {
      total: tasks.length,
      done: doneTasks.length,
      dnd: dndTasks.length,
      postponed: postponedTasks.length,
      notDone: notDoneTasks.length,
      firstStartedAt: firstStartedAt ? firstStartedAt.toISOString() : null,
      lastCompletedAt: lastCompletedAt ? lastCompletedAt.toISOString() : null
    },
    byStaff,
    incidents,
    postponed,
    dnd: dndList,
    tasksSnapshot: tasks // Full copy for audit
  };
  
  // Save to Firestore
  const reportRef = doc(getReportsCollection(), date);
  await setDoc(reportRef, {
    ...report,
    generatedAt: serverTimestamp()
  });
  
  return report;
};
