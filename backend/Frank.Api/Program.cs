using Frank.Api.Data;
using Frank.Api.Endpoints;
using Frank.Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddCors(o => o.AddPolicy("vite",
    p => p.WithOrigins("http://localhost:5173").AllowAnyHeader().AllowAnyMethod()));

var dataDir = Environment.GetEnvironmentVariable("FRANK_DATA_DIR");
var dbPath = AppDbContext.ResolveDbPath(dataDir, builder.Environment.ContentRootPath);
builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlite($"Data Source={dbPath}"));
builder.Services.AddHttpClient("rejestry", c =>
{
    c.Timeout = TimeSpan.FromSeconds(12);
    c.DefaultRequestHeaders.UserAgent.ParseAdd("Frank-Ksiegowosc-JDG/0.1");
});
// KSeF 2.0 (token), bramka JPK e-Dokumenty i Azure blobs — base ustawiane per request.
builder.Services.AddHttpClient("ksef", c =>
{
    c.DefaultRequestHeaders.UserAgent.ParseAdd("Frank-Ksiegowosc-JDG/0.1");
});
builder.Services.AddHttpClient("edokumenty", c =>
{
    c.DefaultRequestHeaders.UserAgent.ParseAdd("Frank-Ksiegowosc-JDG/0.1");
});
builder.Services.AddHttpClient("edokumenty-put", c =>
{
    c.DefaultRequestHeaders.UserAgent.ParseAdd("Frank-Ksiegowosc-JDG/0.1");
});
builder.Services.AddScoped<RejestryService>();
builder.Services.AddScoped<KsefClient>();
builder.Services.AddScoped<JpkGateway>();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
    scope.ServiceProvider.GetRequiredService<AppDbContext>().EnsureSeeded();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseCors("vite");
}

// Frontend (Vite dist) jako wwwroot w obrazie Docker; lokalnie katalog nie istnieje.
var hasWebRoot = app.Environment.WebRootPath is string webRoot && Directory.Exists(webRoot);
if (hasWebRoot)
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
}

ApiEndpoints.Map(app);
MockEndpoints.Map(app);
KsefEndpoints.Map(app);
JpkEndpoints.Map(app);
ZusEndpoints.Map(app);

if (hasWebRoot)
    app.MapFallbackToFile("index.html");

app.Run();
