/** The owner flushes before close and cancels before releasing its resources. */
export function coalescedTask(run: () => void, delay = 250) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => { cancel(); run(); };
  return {
    schedule() { cancel(); timer = setTimeout(flush, delay); },
    flush,
    cancel,
  };
}
