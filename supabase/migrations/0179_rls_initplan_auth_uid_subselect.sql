alter policy own_notification_prefs on public.notification_prefs
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy own_notification_dismissals on public.notification_dismissals
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy own_notification_thresholds_user on public.notification_thresholds_user
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy own_user_profiles on public.user_profiles
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy issue_reports_insert_own on public.issue_reports
  with check (reporter_id = (select auth.uid()));
