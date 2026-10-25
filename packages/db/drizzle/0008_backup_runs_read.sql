-- Installation owners read the backup log through the API role; only the worker writes it.
GRANT SELECT ON "backup_runs" TO bs_app;
