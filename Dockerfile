# Frank — Bun/Vite frontend + .NET 10 API, jeden obraz.
# Frontend budowany Bunem, backend serwuje dist jako wwwroot + /api.

FROM oven/bun:1 AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/bun.lock* ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
RUN bun run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /be
COPY backend/ ./
RUN dotnet publish Frank.Api/Frank.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=backend /app/publish ./
COPY --from=frontend /fe/dist ./wwwroot
ENV ASPNETCORE_URLS=http://+:8080 \
    FRANK_DATA_DIR=/data
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["dotnet", "Frank.Api.dll"]
