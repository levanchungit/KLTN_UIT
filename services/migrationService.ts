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
