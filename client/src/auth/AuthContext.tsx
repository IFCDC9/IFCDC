import React, { createContext, useContext, useEffect, useState } from "react";

type EmployeeInfo = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  location?: string | null;
  status: string;
};

type UserInfo = {
  id: string;
  email: string;
  role: string;
  employee: EmployeeInfo | null;
};

type AuthContextType = {
  user: UserInfo | null;
  loading: boolean;
  token: string | null;
  setToken: (token: string | null) => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  token: null,
  setToken: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setTokenState] = useState<string | null>(
    () => localStorage.getItem("ifcdc_token")
  );
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const setToken = (value: string | null) => {
    setTokenState(value);
    if (value) {
      localStorage.setItem("ifcdc_token", value);
    } else {
      localStorage.removeItem("ifcdc_token");
    }
  };

  useEffect(() => {
    const fetchMe = async () => {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/auth/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data);
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    fetchMe();
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, loading, token, setToken }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
