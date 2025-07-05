import Cookies from 'js-cookie';

interface CookieOptions {
  expires?: number | Date;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
}

const cookieName = 'token';

export const setCookie = (name: string, value: string, options: CookieOptions = {}) => {
  Cookies.set(name, value, {
    expires: 365, // Expires in 1 year
    secure: true,
    sameSite: 'lax',
    ...options,
  });
  setLocalStorageItem(name, value);
};

export const getCookie = (name: string): string | undefined => {
  return Cookies.get(name);
};

export const removeCookie = (name: string) => {
  Cookies.remove(name);
  removeLocalStorageItem(name); 
};


export const setLocalStorageItem = (key: string, value: any) => {
  localStorage.setItem(key, JSON.stringify(value));
};


export const getLocalStorageItem = (key: string) => {
  const item = localStorage.getItem(key);
  return item ? JSON.parse(item) : null;
};
export const removeLocalStorageItem = (key: string) => {
  localStorage.removeItem(key);
};

export const getToken = (): string | null => {
  let token: string | undefined = getCookie(cookieName);

  if (!token) {
    const localStorageToken = getLocalStorageItem(cookieName);
    if (localStorageToken) {
      token = localStorageToken;
      if (typeof token === 'string') { 
        setCookie(cookieName, token, { expires: 365 }); 
      }
    }
  }

  return token ?? null;
};

export const setToken = (token: string, options: CookieOptions = {}) => {
  setCookie(cookieName, token, options);
  setLocalStorageItem(cookieName, token);
};

export const removeToken = () => {
  removeCookie(cookieName);
  removeLocalStorageItem(cookieName);
};
