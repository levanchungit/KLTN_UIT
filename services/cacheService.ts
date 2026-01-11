/**
 * Cache service for frequently accessed data
 * Reduces database queries and improves performance
 */

import { listAccounts, type Account } from "@/repos/accountRepo";
import { listCategories, type Category } from "@/repos/categoryRepo";
import { getCurrentUserId } from "@/utils/auth";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  userId: string;
}

const CACHE_TTL = 30_000; // 30 seconds cache

let accountsCacheInternal: CacheEntry<Account[]> | null = null;
let categoriesCacheInternal: CacheEntry<Category[]> | null = null;
let defaultAccountCacheInternal: CacheEntry<Account | null> | null = null;

/**
 * Get cached accounts or fetch from DB
 */
export async function getCachedAccounts(): Promise<Account[]> {
  const userId = await getCurrentUserId();
  const now = Date.now();

  // Check cache validity
  if (
    accountsCacheInternal &&
    accountsCacheInternal.userId === userId &&
    now - accountsCacheInternal.timestamp < CACHE_TTL
  ) {
    return accountsCacheInternal.data;
  }

  // Fetch fresh data
  const accounts = await listAccounts();
  accountsCacheInternal = {
    data: accounts,
    timestamp: now,
    userId,
  };

  return accounts;
}

/**
 * Get cached default account (prioritize include_in_total=1)
 */
export async function getCachedDefaultAccount(): Promise<Account | null> {
  const userId = await getCurrentUserId();
  const now = Date.now();

  // Check cache validity
  if (
    defaultAccountCacheInternal &&
    defaultAccountCacheInternal.userId === userId &&
    now - defaultAccountCacheInternal.timestamp < CACHE_TTL
  ) {
    return defaultAccountCacheInternal.data;
  }

  // Fetch fresh data
  const accounts = await getCachedAccounts();
  const defaultAccount =
    accounts.find((a) => a.include_in_total === 1) || accounts[0] || null;

  defaultAccountCacheInternal = {
    data: defaultAccount,
    timestamp: now,
    userId,
  };

  return defaultAccount;
}

/**
 * Get cached categories or fetch from DB
 */
export async function getCachedCategories(): Promise<Category[]> {
  const userId = await getCurrentUserId();
  const now = Date.now();

  // Check cache validity
  if (
    categoriesCacheInternal &&
    categoriesCacheInternal.userId === userId &&
    now - categoriesCacheInternal.timestamp < CACHE_TTL
  ) {
    return categoriesCacheInternal.data;
  }

  // Fetch fresh data
  const categories = await listCategories();
  categoriesCacheInternal = {
    data: categories,
    timestamp: now,
    userId,
  };

  return categories;
}

/**
 * Invalidate cache (call after creating/updating accounts or categories)
 */
export function invalidateAccountsCache() {
  accountsCacheInternal = null;
  defaultAccountCacheInternal = null;
}

export function invalidateCategoriesCache() {
  categoriesCacheInternal = null;
}

export function invalidateAllCache() {
  accountsCacheInternal = null;
  categoriesCacheInternal = null;
  defaultAccountCacheInternal = null;
}
