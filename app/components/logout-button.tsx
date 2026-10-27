type LogoutButtonProps = {
  className?: string;
  children?: React.ReactNode;
};

/** POST logout — never use <Link href="/account/logout"> (Next prefetches GET). */
export default function LogoutButton({
  className,
  children = "Log out",
}: LogoutButtonProps) {
  return (
    <form action="/account/logout" method="post" className="contents">
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}
