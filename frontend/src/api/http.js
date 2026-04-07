import axios from 'axios'

export const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080'

export const http = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
})

