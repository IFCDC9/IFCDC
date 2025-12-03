import { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('ifcdc_token') || null);
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('ifcdc_user');
    return stored ? JSON.parse(stored) : null;
  });

  const login = (newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('ifcdc_token', newToken);
    localStorage.setItem('ifcdc_user', JSON.stringify(newUser));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('ifcdc_token');
    localStorage.removeItem('ifcdc_user');
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
