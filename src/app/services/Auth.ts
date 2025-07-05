import { API_URL, VERSION, APP_NAME, API_ENDPOINT } from '../config/index';




export const registerUser = async (data: { name: string; familyName: string; parentPhone: string; email: string; readAndAgreeTerms: boolean }): Promise<{ status: number; data: string }> => {
  const EndPoint = `${API_ENDPOINT}/parent/register`;
  try {
    const res = await fetch(EndPoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const errorData = await res.text();
      console.error("Error from server:", errorData);
      return {
        status: res.status,
        data: errorData,
      };
    }

    const responseData = await res.text();
    return {
      status: res.status,
      data: responseData,
    };
  } catch (error) {
    console.error("Error in RegisterUser:", error);

    if (error instanceof Error) {
      return {
        status: 500,
        data: error.message,
      };
    } else {
      return {
        status: 500,
        data: "An unknown error occurred",
      };
    }
  }
};
export const confirm = async (data: { otp: string; phone: string }): Promise<{ status: number; data: string; token?: string }> => {
  const EndPoint = `${API_ENDPOINT}/parent/confirm`;
  try {
    const res = await fetch(EndPoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const errorData = await res.text();
      console.error("Error from server:", errorData);
      return {
        status: res.status,
        data: errorData,
      };
    }

    const token = res.headers.get("Authorization")?.split(" ")[1];
    const responseData = await res.text();
    return {
      status: res.status,
      data: responseData,
      token: token || "",
    };
  } catch (error) {
    console.error("Error in confirm:", error);

    if (error instanceof Error) {
      return {
        status: 500,
        data: error.message,
      };
    } else {
      return {
        status: 500,
        data: "An unknown error occurred",
      };
    }
  }
};
