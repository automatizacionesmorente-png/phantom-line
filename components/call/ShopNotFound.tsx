/**
 * "This number does not exist": the Call_Page's unknown-shop block (core-call-loop 1.9),
 * shared with the Machine_Page so both say the same thing (owner-machine 1.6). No form,
 * no Call button.
 */
export function ShopNotFound() {
  return (
    <section className="flex flex-col items-center gap-4 py-16 text-center">
      <h1 className="font-newsreader text-4xl font-medium tracking-tight text-ink">
        <span lang="es">
          Este número <span className="text-gold">no existe</span>
        </span>
      </h1>
      <p lang="es" className="font-inter text-lg text-text">
        No encontramos esta tienda. Revisa el enlace que te han dado.
      </p>
      <p lang="en" className="font-inter text-lg text-text">
        Shop not found. Please check the link you were given.
      </p>
    </section>
  );
}
