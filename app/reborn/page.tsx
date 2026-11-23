import { redirect } from "next/navigation";

/** The English name of the wizard; one route with an ES / EN switch lives at /nacer. */
export default function Page(): never {
  redirect("/nacer");
}
