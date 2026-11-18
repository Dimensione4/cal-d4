import classNames from "@calcom/ui/classNames";

export function Logo({
  small,
  icon,
  inline = true,
  className,
  src = "/api/logo",
}: {
  small?: boolean;
  icon?: boolean;
  inline?: boolean;
  className?: string;
  src?: string;
}) {
  // D4: niente dark:invert, il logo D4 è a colori e funziona su chiaro e scuro (l'inversione lo rovina).
  return (
    <h3 className={classNames("logo", inline && "inline", className)}>
      <strong>
        {icon ? (
          <img className="mx-auto w-9" alt="Cal.diy" title="Cal.diy" src={`${src}?type=icon`} />
        ) : (
          <img
            className={small ? "h-4 w-auto" : "h-5 w-auto"}
            alt="Cal.diy"
            title="Cal.diy"
            src={src}
          />
        )}
      </strong>
    </h3>
  );
}
