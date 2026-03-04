// Chambres de l'Hôtel SUB
// 53 unités de nettoyage au total

export const ROOMS = [
  // RDC
  { id: '1', number: 1, floor: 'RDC', type: 'private' },
  { id: '2', number: 2, floor: 'RDC', type: 'private' },
  { id: '3', number: 3, floor: 'RDC', type: 'private' },
  { id: '4', number: 4, floor: 'RDC', type: 'private' },
  
  // 1er
  { id: '10', number: 10, floor: '1er', type: 'private' },
  { id: '11', number: 11, floor: '1er', type: 'private' },
  { id: '12', number: 12, floor: '1er', type: 'private' },
  { id: '14', number: 14, floor: '1er', type: 'private' },
  { id: '15', number: 15, floor: '1er', type: 'private' },
  { id: '16', number: 16, floor: '1er', type: 'private' },
  { id: '17', number: 17, floor: '1er', type: 'private' },
  { id: '18', number: 18, floor: '1er', type: 'private' },
  
  // 2e
  { id: '20', number: 20, floor: '2e', type: 'private' },
  { id: '21', number: 21, floor: '2e', type: 'private' },
  { id: '22', number: 22, floor: '2e', type: 'private' },
  { id: '24', number: 24, floor: '2e', type: 'private' },
  { id: '25', number: 25, floor: '2e', type: 'private' },
  { id: '26', number: 26, floor: '2e', type: 'private' },
  { id: '27', number: 27, floor: '2e', type: 'private' },
  { id: '28', number: 28, floor: '2e', type: 'private' },
  
  // 3e
  { id: '30', number: 30, floor: '3e', type: 'private' },
  { id: '31', number: 31, floor: '3e', type: 'private' },
  { id: '34', number: 34, floor: '3e', type: 'private' },
  { id: '35', number: 35, floor: '3e', type: 'private' },
  { id: '36', number: 36, floor: '3e', type: 'private' },
  { id: '37', number: 37, floor: '3e', type: 'private' },
  { id: '38', number: 38, floor: '3e', type: 'private' },
  // Dortoir 32 (4 lits)
  { id: '32-1', number: '32-1', floor: '3e', type: 'dorm', bed: 1 },
  { id: '32-2', number: '32-2', floor: '3e', type: 'dorm', bed: 2 },
  { id: '32-3', number: '32-3', floor: '3e', type: 'dorm', bed: 3 },
  { id: '32-4', number: '32-4', floor: '3e', type: 'dorm', bed: 4 },
  
  // 4e
  { id: '40', number: 40, floor: '4e', type: 'private' },
  { id: '41', number: 41, floor: '4e', type: 'private' },
  { id: '44', number: 44, floor: '4e', type: 'private' },
  { id: '45', number: 45, floor: '4e', type: 'private' },
  { id: '46', number: 46, floor: '4e', type: 'private' },
  { id: '47', number: 47, floor: '4e', type: 'private' },
  { id: '48', number: 48, floor: '4e', type: 'private' },
  // Dortoir 42 (4 lits)
  { id: '42-1', number: '42-1', floor: '4e', type: 'dorm', bed: 1 },
  { id: '42-2', number: '42-2', floor: '4e', type: 'dorm', bed: 2 },
  { id: '42-3', number: '42-3', floor: '4e', type: 'dorm', bed: 3 },
  { id: '42-4', number: '42-4', floor: '4e', type: 'dorm', bed: 4 },
  
  // 5e
  { id: '50', number: 50, floor: '5e', type: 'private' },
  { id: '51', number: 51, floor: '5e', type: 'private' },
  { id: '54', number: 54, floor: '5e', type: 'private' },
  { id: '55', number: 55, floor: '5e', type: 'private' },
  { id: '56', number: 56, floor: '5e', type: 'private' },
  { id: '57', number: 57, floor: '5e', type: 'private' },
  { id: '58', number: 58, floor: '5e', type: 'private' },
  // Dortoir 52 (4 lits)
  { id: '52-1', number: '52-1', floor: '5e', type: 'dorm', bed: 1 },
  { id: '52-2', number: '52-2', floor: '5e', type: 'dorm', bed: 2 },
  { id: '52-3', number: '52-3', floor: '5e', type: 'dorm', bed: 3 },
  { id: '52-4', number: '52-4', floor: '5e', type: 'dorm', bed: 4 },
];

export const FLOORS = ['RDC', '1er', '2e', '3e', '4e', '5e'];

export const ROOM_TYPES = {
  private: 'Chambre',
  dorm: 'Dortoir'
};

// Types de nettoyage (V2)
export const CLEANING_TYPES = {
  blanc: 'Blanc',
  recouche: 'Recouche'
};

// Statuts simplifiés (V2)
// todo = à faire (non assigné ou assigné)
// in_progress = en cours
// done = terminée (same as ready)
export const TASK_STATUS = {
  todo: 'À faire',
  in_progress: 'En cours',
  done: 'Terminée',
  dnd: 'DND',
  postponed: 'Reportée',
  freed: 'Libérée',
  late_checkout: 'Late Checkout'
};

// Couleurs par statut
export const STATUS_COLORS = {
  todo: '#FFFFFF',
  in_progress: '#FFEDD5', // orange clair
  done: '#DCFCE7', // vert clair
  dnd: '#374151', // gris foncé
  postponed: '#E5E7EB', // gris
  freed: '#FEF9C3', // jaune clair
  late_checkout: '#FFFFFF'
};
