import type { Recipe } from '../../../types/recipe';

let castSession: cast.framework.CastSession | null = null;

export function initializeCastHandler(recipe: Recipe) {
  window.__onGCastApiAvailable = function(available: boolean, reason?: string) {
    if (available) {
      initializeCastApi();
    }
  };

  function initializeCastApi() {
    const context = cast.framework.CastContext.getInstance();
    context.setOptions({
      receiverApplicationId: '3D0A6542',
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
    });

    // Show cast buttons once API is ready
    const castButton = document.getElementById('castButton');
    const castButtonMobile = document.getElementById('castButton-mobile');
    
    [castButton, castButtonMobile].forEach(button => {
      if (button) {
        button.classList.remove('hidden');
        button.classList.add('flex');
        button.addEventListener('click', () => {
          if (!castSession) {
            // Start a new session
            cast.framework.CastContext.getInstance().requestSession().then(
              function(session: cast.framework.CastSession) {
                onSessionStarted(session);
              },
              function(error: Error) {
                console.error('Error starting cast session:', error);
              }
            );
          } else {
            // Session exists, send current recipe
            sendRecipeToReceiver();
          }
        });
      }
    });

    // Listen for session changes
    context.addEventListener(
      cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
      function(event) {
        switch (event.sessionState) {
          case cast.framework.SessionState.SESSION_STARTED:
            if (event.session) {
              onSessionStarted(event.session);
            }
            break;
          case cast.framework.SessionState.SESSION_ENDED:
            castSession = null;
            break;
        }
      }
    );
  }

  function onSessionStarted(session: cast.framework.CastSession) {
    castSession = session;
    sendRecipeToReceiver();
  }

  function sendRecipeToReceiver() {
    if (!castSession) return;
    
    sendMessage({
      type: 'LOAD_RECIPE',
      recipe: recipe
    });
  }

  function sendMessage(message: any) {
    if (!castSession) return;
    
    castSession.sendMessage('urn:x-cast:com.cookbook.cooking', message)
      .catch(function(error) {
        console.error('Error sending message to receiver:', error);
      });
  }
} 