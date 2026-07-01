/** Ensure target has the same keys as source at compile time. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type SameShapeAs<T> = { [K in keyof T]: unknown };
