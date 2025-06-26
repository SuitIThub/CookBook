interface EditModeEvent extends Event {
  detail: {
    isEditMode: boolean;
  };
}

export function initializeEditModeHandler() {
  function updateButtonVisibility(isEditMode: boolean) {
    // Desktop buttons
    const exportContainer = document.getElementById('export-container');
    const addToShoppingBtn = document.getElementById('add-to-shopping');
    const saveBtn = document.getElementById('save-btn');
    
    // Mobile buttons
    const exportContainerMobile = document.getElementById('export-container-mobile');
    const addToShoppingBtnMobile = document.getElementById('add-to-shopping-mobile');
    const saveBtnMobile = document.getElementById('save-btn-mobile');
    
    if (isEditMode) {
      // Hide export and shopping list buttons
      exportContainer?.classList.add('hidden');
      addToShoppingBtn?.classList.add('hidden');
      exportContainerMobile?.classList.add('hidden');
      addToShoppingBtnMobile?.classList.add('hidden');
      
      // Show save buttons
      saveBtn?.classList.remove('hidden');
      saveBtn?.classList.add('flex');
      saveBtnMobile?.classList.remove('hidden');
      saveBtnMobile?.classList.add('flex');
    } else {
      // Show export and shopping list buttons
      exportContainer?.classList.remove('hidden');
      addToShoppingBtn?.classList.remove('hidden');
      exportContainerMobile?.classList.remove('hidden');
      addToShoppingBtnMobile?.classList.remove('hidden');
      
      // Hide save buttons
      saveBtn?.classList.add('hidden');
      saveBtn?.classList.remove('flex');
      saveBtnMobile?.classList.add('hidden');
      saveBtnMobile?.classList.remove('flex');
    }
  }

  // Listen for edit mode changes
  document.addEventListener('editModeChanged', ((event: EditModeEvent) => {
    const isEditMode = event.detail.isEditMode;
    updateButtonVisibility(isEditMode);
  }) as EventListener);

  // Initial state check
  const viewContent = document.getElementById('view-content');
  const isInitiallyHidden = viewContent?.classList.contains('hidden') ?? false;
  updateButtonVisibility(isInitiallyHidden);
} 