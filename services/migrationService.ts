// migrationService removed local_user behavior.
// The app no longer supports a 'local_user' owner mode. These functions are
// intentionally no-ops to avoid accidental ownership transfers.
export async function migrateLocalDataToUser(_newUserId: string) {
  console.warn(
    "migrateLocalDataToUser called but local_user behavior is removed"
  );
  return;
}

export async function migrateUserDataToLocal(_fromUserId: string) {
  console.warn(
    "migrateUserDataToLocal called but local_user behavior is removed"
  );
  return;
}
