/** Đọc JSON phản hồi trong test (không khai báo kiểu cho từng API). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const readJson = async (res: Response): Promise<any> => res.json();
