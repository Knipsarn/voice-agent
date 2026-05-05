/**
 * lib/auth-config.js
 *
 * NextAuth configuration. Two providers:
 *   1. Google OAuth  — production login for customers and admins
 *   2. Credentials   — email + password for testing before giving Google access
 *                      Set DASHBOARD_CREDENTIALS_EMAIL + DASHBOARD_CREDENTIALS_PASSWORD
 *                      in Secret Manager / env. The email is put through the same
 *                      tenant-map as Google, so access scoping is identical.
 *
 * Sessions are JWT-based (no DB needed).
 */

import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { timingSafeEqual, createHash } from "crypto";

function safeCompare(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    CredentialsProvider({
      name: "Email & Password",
      credentials: {
        email:    { label: "Email",    type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const validEmail = process.env.DASHBOARD_CREDENTIALS_EMAIL;
        const validPass  = process.env.DASHBOARD_CREDENTIALS_PASSWORD;
        if (!validEmail || !validPass) return null;
        if (!credentials?.email || !credentials?.password) return null;
        const emailMatch = safeCompare(credentials.email.toLowerCase(), validEmail.toLowerCase());
        const passMatch  = safeCompare(credentials.password, validPass);
        if (!emailMatch || !passMatch) return null;
        return { id: validEmail, email: validEmail, name: "Admin" };
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, account, profile, user }) {
      if (profile?.email) token.email = profile.email;
      if (user?.email)    token.email = user.email;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.email) session.user.email = token.email;
      return session;
    },
  },
  pages: { signIn: "/login" },
};
