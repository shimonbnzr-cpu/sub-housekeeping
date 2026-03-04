// Analytics service using PostHog
// Set VITE_POSTHOG_KEY in .env to enable

import { posthog } from 'posthog-js';

const isEnabled = import.meta.env.VITE_POSTHOG_KEY;

if (isEnabled) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: 'https://app.posthog.com',
    autocapture: true,
  });
}

export const analytics = {
  // Track any event
  track: (eventName, properties = {}) => {
    if (isEnabled) {
      posthog.capture(eventName, properties);
    }
    // Debug log when not enabled
    console.log('[Analytics]', eventName, properties);
  },

  // Page views
  pageView: (pageName) => {
    if (isEnabled) {
      posthog.capture('$pageview', { page: pageName });
    }
    console.log('[Analytics] Page view:', pageName);
  },

  // Identify user (optional)
  identify: (userId, traits = {}) => {
    if (isEnabled) {
      posthog.identify(userId, traits);
    }
  },
};

export default analytics;
