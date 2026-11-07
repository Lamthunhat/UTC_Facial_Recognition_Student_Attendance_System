import { redirect } from "next/navigation";

/** /gv → danh sách lớp của giảng viên. */
export default function InstructorHome() {
  redirect("/gv/lop");
}
