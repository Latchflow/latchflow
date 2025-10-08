import axios, { type AxiosError, type AxiosInstance } from "axios";
import { config } from "./config";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

class ApiClient {
  private client: AxiosInstance;

  constructor(baseURL: string = config.coreApiUrl) {
    this.client = axios.create({
      baseURL,
      withCredentials: true, // Send cookies
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Add response interceptor to transform errors
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<{ message?: string; code?: string; details?: unknown }>) => {
        const status = error.response?.status || 500;
        const data = error.response?.data;

        throw new ApiError(
          data?.message || error.message || "Request failed",
          status,
          data?.code,
          data?.details,
        );
      },
    );
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.client.get<T>(path, { params });
    return response.data;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.client.post<T>(path, body);
    return response.data;
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.client.put<T>(path, body);
    return response.data;
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.client.patch<T>(path, body);
    return response.data;
  }

  async delete<T>(path: string): Promise<T> {
    const response = await this.client.delete<T>(path);
    return response.data;
  }

  /**
   * Download a file as a blob
   */
  async download(path: string): Promise<Blob> {
    const response = await this.client.get<Blob>(path, {
      responseType: "blob",
    });
    return response.data;
  }
}

// Default client instance
export const apiClient = new ApiClient();
