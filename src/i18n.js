import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  fr: {
    translation: {
      // Header
      hotel: 'Hôtel SUB',
      today: 'aujourd\'hui',
      
      // Filters
      allRooms: 'Toutes les chambres',
      autoAssign: 'Auto-assigner',
      reset: 'Réinitialiser',
      import: 'Importer',
      team: 'Équipe',
      staff: 'Staff',
      
      // Progress
      done: 'terminées',
      
      // Room status
      todo: 'À faire',
      inProgress: 'En cours',
      done: 'Terminée',
      freed: 'Libérée',
      dnd: 'Ne pas déranger',
      postponed: 'Reportée',
      
      // Actions
      assignTo: 'Assigner à :',
      type: 'Type :',
      blanc: 'Blanc',
      recouche: 'Recouche',
      status: 'Statut :',
      free: 'Libérer',
      lateCheckout: 'Late Checkout :',
      apply: 'Appliquer',
      delete: 'Supprimer',
      
      // Room types
      white: 'Blanc',
      recouche: 'Recouche',
      
      // Staff view
      selectName: 'Sélectionnez votre prénom',
      choose: '-- Choisir --',
      hello: 'Bonjour',
      toDo: 'à faire',
      inProgress: 'en cours',
      freedSection: 'Libérées - À faire en priorité',
      finished: 'Terminées',
      freed: 'Libérée',
      changeName: 'Changer de prénom',
      progress: 'chambres terminées',
      
      // Task actions
      start: 'Commencer',
      finish: 'Terminer',
      confirm: 'Confirmer',
      cancel: 'Annuler',
      postpone: 'Reporter',
      resume: 'Reprendre',
      unlock: 'Déverrouiller',
      
      // Modal
      finishRoom: 'Terminer chambre',
      incident: 'Un incident à signaler ? (optionnel)',
      
      // Team panel
      teamManagement: 'Gestion de l\'équipe',
      addMember: 'Ajouter un membre',
      present: 'Présente',
      absent: 'Absente',
      add: 'Ajouter',
      close: 'Fermer',
      
      // Import
      importFromMedialog: 'Importer depuis Medialog',
      confirmImport: 'Confirmer l\'import',
      
      // Reset
      resetConfirm: 'Réinitialiser',
      resetWarning: 'Cette action va réinitialiser toutes les chambres (statuts et assignations).',
      resetQuestion: 'Êtes-vous sûr ?',
      
      // Selection
      selected: 'chambre(s) sélectionnée(s)',
      noRooms: 'Aucune chambre assignée',
      noReports: 'Aucun rapport',
      
      // Reports
      reports: 'Rapports',
      print: 'Imprimer',
      summary: 'Résumé global',
      byStaff: 'Par femme de chambre',
      name: 'Nom',
      roomsDone: 'Chambres',
      incidents: 'Incidents',
      incidentsList: 'Incidents',
      postponedRooms: 'Chambres reportées',
      notDone: 'Non faites',
      firstStarted: 'Première',
      lastCompleted: 'Dernière',
      
      // Transfer
      addRooms: 'Ajouter',
      availableRooms: 'Chambres disponibles',
      tapToTake: 'Tap pour récupérer',
    }
  },
  en: {
    translation: {
      // Header
      hotel: 'Hotel SUB',
      today: 'today',
      
      // Filters
      allRooms: 'All rooms',
      autoAssign: 'Auto-assign',
      reset: 'Reset',
      import: 'Import',
      team: 'Team',
      staff: 'Staff',
      
      // Progress
      done: 'done',
      
      // Room status
      todo: 'To do',
      inProgress: 'In progress',
      done: 'Done',
      freed: 'Released',
      dnd: 'Do not disturb',
      postponed: 'Postponed',
      
      // Actions
      assignTo: 'Assign to:',
      type: 'Type:',
      blanc: 'Checkout',
      recouche: 'Turndown',
      status: 'Status:',
      free: 'Release',
      lateCheckout: 'Late Checkout:',
      apply: 'Apply',
      delete: 'Delete',
      
      // Room types
      white: 'Checkout',
      recouche: 'Turndown',
      
      // Staff view
      selectName: 'Select your name',
      choose: '-- Choose --',
      hello: 'Hello',
      toDo: 'to do',
      inProgress: 'in progress',
      freedSection: 'Released - Priority to do',
      finished: 'Done',
      freed: 'Released',
      changeName: 'Change name',
      progress: 'rooms done',
      
      // Task actions
      start: 'Start',
      finish: 'Finish',
      confirm: 'Confirm',
      cancel: 'Cancel',
      postpone: 'Postpone',
      resume: 'Resume',
      unlock: 'Unlock',
      
      // Modal
      finishRoom: 'Finish room',
      incident: 'Any incident to report? (optional)',
      
      // Team panel
      teamManagement: 'Team Management',
      addMember: 'Add a member',
      present: 'Present',
      absent: 'Absent',
      add: 'Add',
      close: 'Close',
      
      // Import
      importFromMedialog: 'Import from Medialog',
      confirmImport: 'Confirm import',
      
      // Reset
      resetConfirm: 'Reset',
      resetWarning: 'This will reset all rooms (statuses and assignments).',
      resetQuestion: 'Are you sure?',
      
      // Selection
      selected: 'room(s) selected',
      noRooms: 'No rooms assigned',
      noReports: 'No reports',
      
      // Reports
      reports: 'Reports',
      print: 'Print',
      summary: 'Summary',
      byStaff: 'By staff',
      name: 'Name',
      roomsDone: 'Rooms',
      incidents: 'Incidents',
      incidentsList: 'Incidents',
      postponedRooms: 'Postponed rooms',
      notDone: 'Not done',
      firstStarted: 'First',
      lastCompleted: 'Last',
      
      // Transfer
      addRooms: 'Add',
      availableRooms: 'Available rooms',
      tapToTake: 'Tap to take',
    }
  },
  ro: {
    translation: {
      // Header
      hotel: 'Hotel SUB',
      today: 'azi',
      
      // Filters
      allRooms: 'Toate camerele',
      autoAssign: 'Auto-atribuire',
      reset: 'Resetare',
      import: 'Import',
      team: 'Echipa',
      staff: 'Personal',
      
      // Progress
      done: 'terminate',
      
      // Room status
      todo: 'De făcut',
      inProgress: 'În curs',
      done: 'Terminat',
      freed: 'Eliberată',
      dnd: 'Nu deranja',
      postponed: 'Amânată',
      
      // Actions
      assignTo: 'Atribuie la:',
      type: 'Tip:',
      blanc: 'Curățare',
      recouche: 'Recouche',
      status: 'Stare:',
      free: 'Eliberează',
      lateCheckout: 'Late Checkout:',
      apply: 'Aplică',
      delete: 'Șterge',
      
      // Room types
      white: 'Curățare',
      recouche: 'Recouche',
      
      // Staff view
      selectName: 'Selectează numele tău',
      choose: '-- Alege --',
      hello: 'Bună',
      toDo: 'de făcut',
      inProgress: 'în curs',
      freedSection: 'Eliberate - Prioritate',
      finished: 'Terminate',
      freed: 'Eliberată',
      changeName: 'Schimbă numele',
      progress: 'camere terminate',
      
      // Task actions
      start: 'Începe',
      finish: 'Termină',
      confirm: 'Confirmă',
      cancel: 'Anulează',
      postpone: 'Amână',
      resume: 'Reluare',
      unlock: 'Deblochează',
      
      // Modal
      finishRoom: 'Termină camera',
      incident: 'Incident de raportat? (opțional)',
      
      // Team panel
      teamManagement: 'Gestionare echipă',
      addMember: 'Adaugă membru',
      present: 'Prezent',
      absent: 'Absent',
      add: 'Adaugă',
      close: 'Închide',
      
      // Import
      importFromMedialog: 'Import din Medialog',
      confirmImport: 'Confirmă importul',
      
      // Reset
      resetConfirm: 'Resetare',
      resetWarning: 'Aceasta va reseta toate camerele (stări și atribuții).',
      resetQuestion: 'Ești sigur?',
      
      // Selection
      selected: 'camer(e) selectate',
      noReports: 'Niciun raport',
      noRooms: 'Nicio cameră atribuită',
      
      // Reports
      reports: 'Rapoarte',
      print: 'Tipărește',
      summary: 'Rezumat',
      byStaff: 'Pe personal',
      name: 'Nume',
      roomsDone: 'Camere',
      incidents: 'Incidente',
      incidentsList: 'Incidente',
      postponedRooms: 'Camere amânate',
      notDone: 'Nefăcute',
      firstStarted: 'Prima',
      lastCompleted: 'Ultima',
      
      // Transfer
      addRooms: 'Adaugă',
      availableRooms: 'Camere disponibile',
      tapToTake: 'Tap pentru a prelua',
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'fr',
    fallbackLng: 'fr',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
