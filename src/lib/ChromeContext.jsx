import { createContext, useContext, useState } from 'react';

// Lets a page (currently just Home, mid-run) tell chrome outside its own
// subtree (NavBar) to collapse, without threading props through App.jsx.
const ChromeContext = createContext(null);

export function ChromeProvider({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <ChromeContext.Provider value={{ collapsed, setCollapsed }}>
      {children}
    </ChromeContext.Provider>
  );
}

export function useChrome() {
  return useContext(ChromeContext);
}
