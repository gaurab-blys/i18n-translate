import { useQuery } from '@tanstack/react-query'
import { http } from './http'

function languagesKey() {
  return ['languages']
}

export function useLanguages() {
  return useQuery({
    queryKey: languagesKey(),
    queryFn: async () => {
      const res = await http.get('/languages')
      return res.data
    },
  })
}

