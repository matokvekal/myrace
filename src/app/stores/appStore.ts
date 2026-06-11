import { create } from 'zustand';
import Cookies from 'js-cookie';
import { setCookie, getCookie, setToken, getToken, removeToken, setLocalStorageItem, getLocalStorageItem } from "@/utils/storageUtils"; // Import utilities

import { registerUser, confirm } from '@/services/Auth';

interface SignUpCredentials {
  familyName: string;
  parentPhone: string;
  email: string;
  readAndAgreeTerms: boolean;
}

interface User {
  phone: string;
  familyName: string;
  name: string;
}

interface AppState {
  user: User | null;
  token: string | null;
  loginState: string | null;
  activeTab: string;
  handleSignUp: (credentials: SignUpCredentials) => Promise<{ status: number; data: string }>;
  handleSendOtp: (otp: string) => Promise<{ status: number; data: string }>;
  getUser: () => Promise<{ user: User | null; token: string | null } | null>;
  setLoginState: (state: string | null) => void;
  checkLogin: () => Promise<boolean>;
  setActiveTab: (tab: string) => void;
}

export const useDataStore = create<AppState>((set, get) => ({
  user: null,
  token: null,
  loginState: null,
  activeTab: 'riders', // Default tab

  handleSignUp: async ({ familyName, parentPhone, email, readAndAgreeTerms }) => {
    try {
      const { status, data } = await registerUser({ familyName, parentPhone, email, name: 'test', readAndAgreeTerms });
      if (status === 200) {
        const user: User = { phone: parentPhone, familyName, name: familyName };
        set({ user, loginState: 'otp' });
        Cookies.set('user', JSON.stringify(user));
      }
      return { status, data };
    } catch (error) {
      console.error('SignUp failed', error);
      return { status: 500, data: 'SignUp failed' };
    }
  },

  handleSendOtp: async (otp) => {
    try {
      //todo add this
      const user = await get().getUser();
      let phone = get().user?.phone;
      if (!phone) {
        return { status: 1, data: 'No user found' };
      }

      const res = await confirm({ otp, phone });
      if (res.status === 200) {
        const storedUser = Cookies.get('user');
        if (storedUser) {
          const user: User = JSON.parse(storedUser);
          set({ user, token: res.token, loginState: 'main' });
          Cookies.set('user', JSON.stringify(user));
          Cookies.set('token', res.token || "");

          setLocalStorageItem('Allkids', res.token || "");
        }
      }
      return res;
    } catch (error) {
      console.error('Send OTP failed', error);
      return { status: 500, data: 'Send OTP failed' };
    }
  },

  getUser: async () => {
    const stateUser = get().user;
    const stateToken = get().token;
    if (stateUser && stateToken) {
      return { user: stateUser, token: stateToken };
    }

    const storedUser = Cookies.get('user');
    let storedToken = Cookies.get('token');
    if (!storedToken) {
      storedToken = getLocalStorageItem('Allkids');
      if (storedToken) {
        Cookies.set('token', storedToken, { expires: 365 }); // Update cookie
      }
    }


    if (storedUser && storedToken) {
      const user: User = JSON.parse(storedUser);
      const token: string = storedToken;
      set({ user, token });
      return { user, token };
    }
    return null;
  },

  setLoginState: (state) => {
    set({ loginState: state });
  },

  checkLogin: async () => {
    try {

      const tokenCookie = Cookies.get("token");

      if (tokenCookie) {
        set({
          token: tokenCookie,
          loginState: "main",
        });

        return true;
      }
      return false;
    } catch (error) {
      console.error("Error in checkLogin:", error);
      return false;
    }
  },

  setActiveTab: (tab: string) => {
    set({ activeTab: tab });
  },

}));
