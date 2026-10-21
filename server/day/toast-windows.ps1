# Day nudge (Windows): shows one Windows notification. Called by server/day/nudge.ts.
param([string]$Title = 'trench-flow', [string]$Text = '')
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$t = [Security.SecurityElement]::Escape($Title)
$b = [Security.SecurityElement]::Escape($Text)
$x.LoadXml("<toast><visual><binding template=`"ToastGeneric`"><text>$t</text><text>$b</text></binding></visual></toast>")
# PowerShell's own app id, so no app registration is needed
$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))
