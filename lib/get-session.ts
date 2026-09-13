import { headers } from "next/headers";
import { auth } from "./auth";

export async function getSession() {
  const headersList = await headers();
  const cookie = headersList.get("cookie");

  if (!cookie || !auth) {
    return null;
  }

  try {
    const session = await auth.api.getSession({
      headers: {
        cookie,
      },
    });
    return session;
  } catch (error) {
    console.error("Error getting session:", error);
    return null;
  }
}

export async function getCurrentUser() {
  const session = await getSession();
  return session?.user || null;
}

export async function getCurrentUserId() {
  const user = await getCurrentUser();
  return user?.id || null;
}
