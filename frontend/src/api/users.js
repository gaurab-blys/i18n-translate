import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from './http'

function usersKey() {
  return ['users']
}

function userKey(userId) {
  return ['users', userId]
}

export function useUsers() {
  return useQuery({
    queryKey: usersKey(),
    queryFn: async () => {
      const res = await http.get('/users')
      return res.data
    },
  })
}

export function useUser(userId) {
  return useQuery({
    queryKey: userKey(userId),
    enabled: Boolean(userId),
    queryFn: async () => {
      const res = await http.get(`/users/${encodeURIComponent(userId)}`)
      return res.data
    },
  })
}

export function useUpdateUserLanguage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, languageCode }) => {
      const res = await http.put(`/users/${encodeURIComponent(userId)}/language`, {
        languageCode,
      })
      return res.data
    },
    onSuccess: (updatedUser) => {
      if (updatedUser?.userId) {
        queryClient.setQueryData(userKey(updatedUser.userId), updatedUser)
      }
      queryClient.invalidateQueries({ queryKey: usersKey() })
    },
  })
}

export function useUpsertUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, address, notes }) => {
      const res = await http.put(`/users/${encodeURIComponent(userId)}`, {
        address: address ?? null,
        notes: notes ?? null,
      })
      return res.data
    },
    onSuccess: (updatedUser) => {
      if (updatedUser?.userId) {
        queryClient.setQueryData(userKey(updatedUser.userId), updatedUser)
      }
      queryClient.invalidateQueries({ queryKey: usersKey() })
    },
  })
}

