import jwt from "jsonwebtoken";

export function createToken(user) {
  return jwt.sign(
    {
      userId: user._id,
      role: user.role,
      roles: Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role],
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}
